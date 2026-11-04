import {getArchive, pageURL, webURL, writeArchive} from './db.js';

const MAX_PAGES = 40;
const MAX_ASSETS = 90;
const PAGE_BYTES = 2_000_000;
const ASSET_BYTES = 4_000_000;
const ARCHIVE_BYTES = 96_000_000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let job = null;

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.to !== 'capture' || sender.id !== chrome.runtime.id || sender.tab) return;
  if (message.type === 'status') reply(job);
  if (message.type !== 'start') return;
  if (job?.running) return reply({ok: false, error: 'An archive operation is already running.'});
  job = {running: true, root: message.root, mode: message.mode, action: message.action,
    phase: 'Starting…', done: 0, total: 1, skipped: 0};
  reply({ok: true});
  run(message).catch(error => {
    job.phase = error.message;
    job.outcome = 'error';
  }).finally(() => { job.running = false; });
});

async function request(url, limit, expected) {
  const response = await fetch(url, {
    credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error('The server returned HTTP ' + response.status + '.');
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (expected && !expected.test(type)) throw new Error('Unsupported content type.');
  if (Number(response.headers.get('content-length')) > limit) throw new Error('Response exceeds the size limit.');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error('Response exceeds the size limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return {blob: new Blob(chunks, {type}), headers: response.headers};
}

async function robotsRules(origin) {
  const response = await request(origin + '/robots.txt', 256_000).catch(error => {
    if (/HTTP (404|410)\./.test(error.message)) return null;
    throw new Error('The site’s robots.txt could not be checked. Try saving a single page.');
  });
  if (!response) return () => true;
  const groups = [];
  let group;
  for (const line of (await response.blob.text()).split(/\r?\n/)) {
    const match = /^\s*([^:]+):\s*(.*?)\s*(?:#.*)?$/.exec(line);
    if (!match) continue;
    const field = match[1].trim().toLowerCase(), value = match[2];
    if (field === 'user-agent') {
      if (!group || group.rules.length) groups.push(group = {agents: [], rules: []});
      group.agents.push(value.toLowerCase());
    }
    if (group && value && ['allow', 'disallow'].includes(field)) {
      const escaped = value.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*');
      const pattern = escaped.endsWith('\\$') ? escaped.slice(0, -2) + '$' : escaped;
      group.rules.push({pattern: new RegExp('^' + pattern), length: value.length, allow: field === 'allow'});
    }
  }
  const specific = groups.filter(entry => entry.agents.includes('cachebuddy'));
  const selected = specific.length ? specific : groups.filter(entry => entry.agents.includes('*'));
  const rules = selected.flatMap(entry => entry.rules).sort((a, b) => b.length - a.length || b.allow - a.allow);
  return url => {
    const address = new URL(url);
    return rules.find(rule => rule.pattern.test(address.pathname + address.search))?.allow ?? true;
  };
}

const forbidden = 'script,noscript,template,iframe,frame,frameset,object,embed,portal,svg,math,video,audio,source,track,canvas,input,select,textarea,button,base,meta,link,style';
const allowedTags = new Set(('a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup data dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark menu nav ol p picture pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr').split(' '));
const allowedAttrs = new Set(('id class title dir lang role hidden open alt width height align valign colspan rowspan scope start reversed type value datetime span style').split(' '));
const layoutData = /^data-(?:theme|mode|state|layout|color-scheme)$/;
const deniedByMeta = (name, content) => /^(robots|cachebuddy)$/i.test(name) && /\bnoarchive\b/i.test(content);
const localData = /^data:(?:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd.microsoft.icon)|font\/(?:woff2?|ttf|otf));base64,[a-z0-9+/=\s]+$/i;
const assetType = /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)|font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|font-sfnt|vnd\.ms-fontobject))$/;

function dataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function assetsFor(origin, allowed) {
  const resources = new Map();
  const failed = new Set();
  let bytes = 0, skipped = 0;
  return {
    get skipped() { return skipped; },
    get fetched() { return [...resources].filter(([, value]) => value).map(([key]) => key); },
    failed,
    async get(value, base, css = false) {
      const raw = value.trim();
      if (!css && localData.test(raw) && raw.length <= ASSET_BYTES) return raw;
      const url = webURL(raw, base);
      if (!url || url.origin !== origin || !allowed(url.href)) { skipped++; return ''; }
      url.hash = '';
      const key = (css ? 'css:' : 'data:') + url.href;
      if (resources.has(key)) return resources.get(key);
      if (resources.size >= MAX_ASSETS || bytes >= ARCHIVE_BYTES) { skipped++; return ''; }
      job.phase = 'Saving resources from ' + url.pathname.slice(0, 100);
      let valueOut = '';
      try {
        const {blob} = await request(url.href, css ? PAGE_BYTES : ASSET_BYTES, css ? /^text\/css$/ : assetType);
        if (bytes + blob.size > ARCHIVE_BYTES) throw new Error('Resource budget reached.');
        bytes += blob.size;
        valueOut = css ? await blob.text() : await dataURL(blob);
      } catch {
        failed.add(key);
        skipped++;
      }
      resources.set(key, valueOut);
      return valueOut;
    }
  };
}

async function rewriteCSS(css, base, assets, imports = new Set()) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const importsFound = /@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)|"([^"]*)"|'([^']*)')([^;{}]*);/gi;
  const headers = [];
  css = css.replace(importsFound, (_match, a, b, c, d, e, condition) => {
    headers.push([a ?? b ?? c ?? d ?? e, condition.trim()]);
    return '';
  });
  const importsText = [];
  for (const [ref, condition] of headers.slice(0, 20)) {
    const url = pageURL(ref, base);
    if (!url || imports.has(url) || imports.size >= 8 || /^(layer|supports)\b/i.test(condition)) continue;
    const content = await assets.get(url, base, true);
    if (!content) continue;
    const rewritten = await rewriteCSS(content, url, assets, new Set([...imports, url]));
    importsText.push(condition ? '@media ' + condition + '{' + rewritten + '}' : rewritten);
  }
  const tokens = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi;
  const pieces = [];
  let last = 0;
  for (const match of css.matchAll(tokens)) {
    pieces.push(css.slice(last, match.index));
    const ref = match[1] ?? match[2] ?? match[3];
    const data = await assets.get(ref, base);
    pieces.push(data ? 'url("' + data + '")' : 'url("")');
    last = match.index + match[0].length;
    if (pieces.length >= 1_200) break;
  }
  return importsText.join('\n') + '\n' + pieces.join('') + css.slice(last);
}

async function snapshot(html, url, resources) {
  let embedded = 0;
  const assets = {
    async get(ref, base, css) {
      if (embedded >= 12_000_000) return '';
      const value = await resources.get(ref, base, css);
      embedded += value.length;
      return embedded <= 12_000_000 ? value : '';
    }
  };
  const template = document.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  const wrapperAttrs = {};
  const rootTags = /<(html|body)(?=\s|>)(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  for (const match of html.matchAll(rootTags)) {
    const tag = match[1].toLowerCase();
    if (Object.hasOwn(wrapperAttrs, tag)) continue;
    const inert = document.createElement('template');
    inert.innerHTML = match[0].replace(/^<(html|body)/i, '<div');
    const node = inert.content.firstElementChild;
    for (const attr of [...node.attributes]) {
      if (!['id', 'class', 'dir', 'lang'].includes(attr.name) && !layoutData.test(attr.name)) {
        node.removeAttributeNode(attr);
      }
    }
    wrapperAttrs[tag] = node.outerHTML.slice(4, -7);
    if (Object.keys(wrapperAttrs).length === 2) break;
  }
  for (const meta of content.querySelectorAll('meta[name][content]')) {
    if (deniedByMeta(meta.name, meta.content)) throw new Error('The publisher requests that this page not be archived.');
  }
  const title = content.querySelector('title')?.textContent.trim().slice(0, 200) || new URL(url).hostname;
  const baseRef = content.querySelector('base[href]')?.getAttribute('href');
  const base = webURL(baseRef || url, url)?.href || url;
  const styles = [];
  for (const element of [...content.querySelectorAll('style,link[rel~="stylesheet"]')].slice(0, 40)) {
    const href = element.getAttribute('href');
    const cssURL = href && pageURL(href, base);
    const css = cssURL ? await assets.get(cssURL, base, true) : element.textContent;
    if (!css) continue;
    const rewritten = await rewriteCSS(css, cssURL || base, assets, new Set(cssURL ? [cssURL] : []));
    const media = element.getAttribute('media');
    styles.push(media ? '@media ' + media + '{' + rewritten + '}' : rewritten);
  }
  content.querySelectorAll(forbidden + ',title').forEach(element => element.remove());
  const links = new Set();
  for (const element of content.querySelectorAll('*')) {
    const tag = element.localName;
    if (!allowedTags.has(tag) || element.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      element.replaceWith(...element.childNodes);
      continue;
    }
    const inlineCSS = element.getAttribute('style');
    const href = tag === 'a' ? element.getAttribute('href') : null;
    const image = tag === 'img' ? element.getAttribute('src') || element.getAttribute('data-src') ||
      element.getAttribute('srcset')?.trim().split(/\s|,/)[0] : null;
    for (const attr of [...element.attributes]) {
      if (!allowedAttrs.has(attr.name) && !attr.name.startsWith('aria-') && !layoutData.test(attr.name)) element.removeAttributeNode(attr);
    }
    if (inlineCSS) element.setAttribute('style', await rewriteCSS(inlineCSS, base, assets));
    if (href !== null) {
      const target = webURL(href, base);
      if (target) {
        const normalized = pageURL(target.href);
        if (normalized === url && target.hash) {
          element.setAttribute('href', target.hash);
        } else {
          element.setAttribute('href', target.href);
          element.setAttribute('target', '_top');
          if (normalized !== url && !/\b(?:logout|log-out|signout|sign-out|unsubscribe|delete|checkout)\b/i.test(target.pathname + target.search)) {
            links.add(normalized);
          }
        }
      }
    }
    if (image) {
      const data = await assets.get(image, base);
      if (data) element.setAttribute('src', data);
    }
  }
  // Text in a style element needs escaping before embedding in srcdoc.
  const safeCSS = styles.join('\n').replace(/<\/style/gi, '<\\/style');
  const csp = "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  const output = '<!doctype html><html' + (wrapperAttrs.html || '') + '><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp +
    '"><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + safeCSS +
    '</style></head><body' + (wrapperAttrs.body || '') + '>' + template.innerHTML + '</body></html>';
  return {title, html: output, links: [...links]};
}

async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function run({mode, action, root, live}) {
  const origin = new URL(root).origin;
  const id = mode === 'site' ? 'site:' + origin : 'page:' + root;
  const previous = await getArchive(id);
  if (action === 'check' && !previous) throw new Error('Save this archive before checking for changes.');
  const allowed = mode === 'site' ? await robotsRules(origin) : () => true;
  const assets = assetsFor(origin, allowed);
  const queue = [root];
  const seen = new Set(queue);
  const pages = [];
  let bytes = 0, capped = false;
  const failures = [];
  const enqueue = url => {
    if (!url || new URL(url).origin !== origin || seen.has(url)) return;
    if (seen.size >= MAX_PAGES) { capped = true; return; }
    seen.add(url);
    queue.push(url);
  };
  if (mode === 'site') enqueue(origin + '/');
  while (queue.length) {
    const url = queue.shift();
    job.total = job.done + queue.length + 1;
    job.phase = (action === 'check' ? 'Checking ' : 'Reading ') + new URL(url).pathname;
    try {
      if (!allowed(url)) throw new Error('Blocked by the site’s robots.txt.');
      let html = mode === 'page' ? live : null;
      if (!html) {
        const response = await request(url, PAGE_BYTES, /^(?:text\/html|application\/xhtml\+xml)$/);
        if (/\bnoarchive\b/i.test(response.headers.get('x-robots-tag') || '')) {
          throw new Error('The publisher requests that this page not be archived.');
        }
        html = await response.blob.text();
      }
      const copy = await snapshot(html, url, assets);
      const size = new Blob([copy.html]).size;
      if (bytes + size > ARCHIVE_BYTES) {
        capped = true;
        throw new Error('The archive reached its 96 MB limit.');
      }
      const digest = await hash(copy.title + '\n' + copy.html);
      pages.push({url, title: copy.title, html: copy.html, digest, size});
      bytes += size;
      if (mode === 'site') copy.links.forEach(enqueue);
    } catch (error) {
      if (url === root) throw error;
      failures.push(url);
      job.skipped = failures.length;
    }
    job.done++;
    job.total = job.done + queue.length;
    if (queue.length) await delay(250);
  }
  const byURL = Object.fromEntries(pages.map(page => [page.url, page.digest]));
  const uncertain = Boolean(previous && (failures.some(url => Object.hasOwn(previous.byURL, url)) ||
    previous.assets?.some(key => assets.failed.has(key))));
  const changed = Boolean(previous && (
    pages.some(page => previous.byURL[page.url] !== page.digest) ||
    Object.keys(previous.byURL).some(url => !Object.hasOwn(byURL, url) && !failures.includes(url))
  ));
  job.capped = capped;
  job.skippedAssets = assets.skipped;
  if (action === 'check') {
    job.outcome = changed ? 'changed' : uncertain ? 'incomplete' : 'same';
    job.phase = changed ? 'Changes found. Your saved copy is ready to update.' :
      uncertain ? 'Some saved pages or resources could not be checked.' : 'No changes found in the pages checked.';
    return;
  }
  if (uncertain) throw new Error('Some previously saved pages or resources could not be read. The existing archive was kept.');
  job.phase = 'Writing the archive…';
  const savedAt = Date.now();
  await writeArchive(id, {
    id, root, mode, origin, savedAt, title: pages[0].title, bytes, count: pages.length, byURL,
    skipped: failures.length, skippedAssets: assets.skipped, assets: assets.fetched, capped
  }, pages);
  job.outcome = 'saved';
  job.phase = pages.length + (pages.length === 1 ? ' page saved' : ' pages saved') + ' for offline use.';
}
