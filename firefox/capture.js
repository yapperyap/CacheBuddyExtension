import {getArchive, pageURL, webURL, writeArchive} from './db.js';

const MAX_PAGES = 40;
const MAX_ASSETS = 256;
const PAGE_BYTES = 2_000_000;
const ASSET_BYTES = 4_000_000;
const ARCHIVE_BYTES = 96_000_000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let job = null;

export function captureStatus() {
  return job;
}

export function beginCapture(message) {
  if (job?.running) return {ok: false, error: 'An archive operation is already running.'};
  job = {running: true, root: message.root, mode: message.mode, action: message.action,
    phase: 'Starting…', done: 0, total: 1, skipped: 0};
  run(message).catch(error => {
    job.phase = error.message;
    job.outcome = 'error';
  }).finally(() => { job.running = false; });
  return {ok: true};
}

async function request(url, limit, expected, followRedirects = false) {
  const response = await fetch(url, {
    credentials: 'omit', redirect: followRedirects ? 'follow' : 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
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
  return {blob: new Blob(chunks, {type}), headers: response.headers, url: response.url};
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

const forbidden = 'script,noscript,template,iframe,frame,frameset,object,embed,portal,canvas,base,meta,link,style';
const adPlacements = 'ins.adsbygoogle,[data-ad-client][data-ad-slot],[data-google-query-id],[id^="div-gpt-ad"],amp-ad';
const svgNamespace = 'http://www.w3.org/2000/svg';
const mathNamespace = 'http://www.w3.org/1998/Math/MathML';
const svgTags = new Set(('svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath title desc clipPath mask pattern marker linearGradient radialGradient stop filter feBlend feColorMatrix feComposite feDropShadow feFlood feGaussianBlur feMerge feMergeNode feOffset').split(' '));
const mathTags = new Set(('math mrow mi mn mo mtext mspace ms mfrac msqrt mroot mstyle merror mpadded mphantom menclose msub msup msubsup munder mover munderover mtable mtr mtd semantics annotation').split(' '));
const allowedTags = new Set(('input label button form fieldset legend select option optgroup textarea output dialog meter progress audio video source track a abbr address article aside b bdi bdo blockquote br caption cite code col colgroup data dd del details dfn div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hgroup hr i img ins kbd li main mark menu nav ol p picture pre q rp rt ruby s samp section small span strong sub summary sup table tbody td tfoot th thead time tr u ul var wbr').split(' '));
const allowedAttrs = new Set(('checked disabled for id class title dir lang role hidden open alt width height align valign colspan rowspan scope start reversed type value datetime span style name selected multiple size rows cols placeholder readonly required min max step low high optimum label tabindex wrap srclang kind default muted loop controls playsinline').split(' '));
const layoutData = /^data-[a-z0-9_.:-]+$/;
const deniedByMeta = (name, content) => /^(robots|cachebuddy)$/i.test(name) && /\bnoarchive\b/i.test(content);
const localData = /^data:(?:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon|vnd.microsoft.icon)|font\/(?:woff2?|ttf|otf)|audio\/(?:mpeg|mp4|ogg|wav|webm|aac|flac|x-wav)|video\/(?:mp4|webm|ogg)|text\/vtt);base64,[a-z0-9+/=\s]+$/i;
const assetType = /^(?:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml|x-icon|vnd\.microsoft\.icon)|audio\/(?:mpeg|mp4|ogg|wav|webm|aac|flac|x-wav)|video\/(?:mp4|webm|ogg)|text\/vtt|font\/(?:woff2?|ttf|otf)|application\/(?:font-woff|font-sfnt|vnd\.ms-fontobject))$/;

function dataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function assetsFor(origin, allowed, saveMedia) {
  const resources = new Map();
  const failed = new Set();
  let bytes = 0;
  const omissions = new Map();
  function noteSkipped(reason, key) {
    if (!omissions.has(key)) omissions.set(key, reason);
  }
  return {
    get skipped() { return omissions.size; },
    get reasons() {
      const counts = {};
      for (const reason of omissions.values()) counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    },
    noteSkipped,
    get fetched() { return [...resources].filter(([, value]) => value).map(([key]) => key); },
    failed,
    async get(value, base, css = false, styling = false) {
      if (!css && !styling && !saveMedia) return '';
      const raw = value.trim();
      if (!raw || raw.startsWith('#')) return '';
      const rawKey = (css ? 'css:' : 'data:') + raw;
      if (!css && localData.test(raw)) {
        if (raw.length <= ASSET_BYTES) return raw;
        noteSkipped('file size limit', rawKey); return '';
      }
      // Wikipedia's CSS embeds percent-encoded SVG icons; these require no fetch.
      if (!css && /^data:image\/svg\+xml(?:;(?:charset=[^;,]+|utf8))?(?:;base64)?,/i.test(raw)) {
        try {
          const comma = raw.indexOf(',');
          const payload = raw.slice(comma + 1);
          const bytes = /;base64,/i.test(raw.slice(0, comma + 1))
            ? Uint8Array.from(atob(payload), char => char.charCodeAt(0))
            : new TextEncoder().encode(decodeURIComponent(payload));
          if (bytes.length > ASSET_BYTES) { noteSkipped('file size limit', rawKey); return ''; }
          return await dataURL(new Blob([bytes], {type: 'image/svg+xml'}));
        } catch { noteSkipped('invalid inline image', rawKey); return ''; }
      }
      const url = webURL(raw, base);
      if (!url || (url.origin === origin && !allowed(url.href))) { noteSkipped(url ? 'publisher restriction' : 'unsupported URL', rawKey); return ''; }
      const fragment = url.hash;
      url.hash = '';
      const key = (css ? 'css:' : 'data:') + url.href;
      if (resources.has(key)) {
        const cached = resources.get(key);
        return css || !cached ? cached : cached + fragment;
      }
      const permission = url.origin + '/*';
      if (!await browser.permissions.contains({origins: [permission]})) { noteSkipped('site permission denied', key); return ''; }
      if (resources.size >= MAX_ASSETS || bytes >= ARCHIVE_BYTES) { noteSkipped(resources.size >= MAX_ASSETS ? 'resource count limit' : 'archive size limit', key); return ''; }
      job.phase = 'Saving resources from ' + url.pathname.slice(0, 100);
      let valueOut = '';
      try {
        const {blob, url: finalURL} = await request(url.href, css ? PAGE_BYTES : ASSET_BYTES, css ? /^text\/css$/ : assetType, true);
        if (bytes + blob.size > ARCHIVE_BYTES) throw new Error('Resource budget reached.');
        bytes += blob.size;
        valueOut = css ? {text: await blob.text(), url: finalURL || url.href} : await dataURL(blob);
      } catch (error) {
        failed.add(key);
        const reason = /HTTP \d+/.exec(error.message)?.[0] || (/size limit|budget/i.test(error.message) ? 'file or archive size limit' : /content type/i.test(error.message) ? 'unsupported content type' : 'network or server failure');
        noteSkipped(reason, key);
      }
      resources.set(key, valueOut);
      return css || !valueOut ? valueOut : valueOut + fragment;
    }
  };
}

async function rewriteCSS(css, base, assets, imports = new Set()) {
  css = css.replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\*[\s\S]*?\*\//g,
    token => token.startsWith('/*') ? ' ' : token).replace(/^\s*@charset\s+"[^"]*";/i, '');
  const importsFound = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)|"([^"]*)"|'([^']*)')([^;{}]*);/gi;
  const headers = [];
  css = css.replace(importsFound, (match, a, b, c, d, e, condition) => {
    if (condition === undefined) return match;
    headers.push([a ?? b ?? c ?? d ?? e, condition.trim()]);
    return '/*cachebuddy-import:' + (headers.length - 1) + '*/';
  });
  const importsText = [];
  for (const [index, [ref, condition]] of headers.slice(0, 20).entries()) {
    const url = pageURL(ref, base);
    if (!url || imports.has(url) || imports.size >= 8) continue;
    const content = await assets.get(url, base, true);
    if (!content) continue;
    let rewritten = await rewriteCSS(content.text, content.url, assets, new Set([...imports, url, content.url]));
    let media = condition;
    const layer = /^layer(?:\(([^)]*)\)|(?=\s|$))\s*/i.exec(media);
    if (layer) media = media.slice(layer[0].length);
    const supports = /^supports\(/i.exec(media);
    if (supports) {
      let depth = 1;
      const tail = media.slice(supports[0].length);
      const end = [...tail.matchAll(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[()]/g)].find(token => {
        if (token[0] === '(') depth++;
        if (token[0] === ')') depth--;
        return depth === 0;
      });
      if (!end) continue;
      const condition = tail.slice(0, end.index);
      const test = /^\s*[\w-]+\s*:/.test(condition) ? '(' + condition + ')' : condition;
      media = tail.slice(end.index + 1).trim();
      if (media) rewritten = '@media ' + media + '{' + rewritten + '}';
      rewritten = '@supports ' + test + '{' + rewritten + '}';
    } else if (media) {
      rewritten = '@media ' + media + '{' + rewritten + '}';
    }
    if (layer) rewritten = '@layer ' + (layer[1] || '') + '{' + rewritten + '}';
    importsText[index] = rewritten;
  }
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(?<![\w-])url\(\s*(?:"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|((?:\\[\s\S]|[^\\\s)])+))\s*\)/gi;
  const pieces = [];
  let last = 0;
  for (const match of css.matchAll(tokens)) {
    const token = match[1] ?? match[2] ?? match[3];
    if (token === undefined) continue;
    pieces.push(css.slice(last, match.index));
    const ref = token.replace(/\\(?:([0-9a-f]{1,6})\s?|(\r\n|[\n\r\f])|([\s\S]))/gi, (_all, hex, newline, char) => {
      if (hex) {
        const code = parseInt(hex, 16);
        return String.fromCodePoint(code > 0 && code <= 0x10ffff ? code : 0xfffd);
      }
      return newline ? '' : char;
    });
    const data = ref.startsWith('#') ? ref : await assets.get(ref, base, false, true);
    pieces.push(data ? 'url(' + JSON.stringify(data) + ')' : 'url("")');
    last = match.index + match[0].length;
    if (pieces.length >= 1_200) break;
  }
  return (pieces.join('') + css.slice(last)).replace(/\/\*cachebuddy-import:(\d+)\*\//g,
    (_token, index) => importsText[index] || '');
}

async function snapshot(html, url, resources, saveMedia, removeAds) {
  let embedded = 0;
  const assets = {
    async get(ref, base, css, styling) {
      if (embedded >= 12_000_000) { resources.noteSkipped('page size limit', ref); return ''; }
      const value = await resources.get(ref, base, css, styling);
      embedded += css ? (value?.text.length || 0) : value.length;
      if (embedded > 12_000_000) { resources.noteSkipped('page size limit', ref); return ''; }
      return value;
    }
  };
  const template = document.createElement('template');
  template.innerHTML = html;
  const content = template.content;
  if (removeAds) content.querySelectorAll(adPlacements).forEach(element => element.remove());
  const wrappers = {};
  const rootTags = /<(html|body)(?=\s|>)(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi;
  for (const match of html.matchAll(rootTags)) {
    const tag = match[1].toLowerCase();
    if (Object.hasOwn(wrappers, tag)) continue;
    const inert = document.createElement('template');
    inert.innerHTML = match[0].replace(/^<(html|body)/i, '<div');
    const node = inert.content.firstElementChild;
    for (const attr of [...node.attributes]) {
      if (!['id', 'class', 'dir', 'lang', 'style'].includes(attr.name) && !layoutData.test(attr.name)) {
        node.removeAttributeNode(attr);
      }
    }
    wrappers[tag] = node;
    if (Object.keys(wrappers).length === 2) break;
  }
  for (const meta of content.querySelectorAll('meta[name][content]')) {
    if (deniedByMeta(meta.name, meta.content)) throw new Error('The publisher requests that this page not be archived.');
  }
  const title = [...content.querySelectorAll('title')].find(node => node.namespaceURI !== svgNamespace)?.textContent.trim().slice(0, 200) || new URL(url).hostname;
  const baseRef = content.querySelector('base[href]')?.getAttribute('href');
  const base = webURL(baseRef || url, url)?.href || url;
  for (const wrapper of Object.values(wrappers)) {
    if (wrapper.hasAttribute('style')) {
      wrapper.setAttribute('style', await rewriteCSS(wrapper.getAttribute('style'), base, assets));
    }
  }
  // Reserve space for the main stylesheets before downloading other resources.
  const sheets = [];
  for (const element of [...content.querySelectorAll('style,link[rel~="stylesheet"]')].slice(0, 40)) {
    const href = element.getAttribute('href');
    const cssURL = href && pageURL(href, base);
    const css = cssURL ? await assets.get(cssURL, base, true) : {text: element.textContent, url: base};
    if (css?.text) sheets.push({css, cssURL, media: element.getAttribute('media')});
  }
  const imageData = new Map();
  for (const image of content.querySelectorAll('img,input[type="image"]')) {
    const ref = image.getAttribute('src') || image.getAttribute('data-src') ||
      image.getAttribute('srcset')?.trim().split(/\s/)[0].replace(/,+$/, '');
    if (ref) {
      const data = await assets.get(ref, base);
      if (data) imageData.set(image, data);
    }
  }
  const styles = [];
  for (const {css, cssURL, media} of sheets) {
    const rewritten = await rewriteCSS(css.text, css.url, assets, new Set(cssURL ? [cssURL, css.url] : []));
    const style = document.createElement('style');
    if (media) style.setAttribute('media', media);
    style.textContent = rewritten.replace(/<\/style/gi, '<\\/style');
    styles.push(style.outerHTML);
  }
  content.querySelectorAll(forbidden + ',title').forEach(element => {
    if (element.localName !== 'title' || element.namespaceURI !== svgNamespace) element.remove();
  });
  const links = new Set();
  for (const element of content.querySelectorAll('*')) {
    const tag = element.localName;
    if (!content.contains(element)) continue;
    const svg = element.namespaceURI === svgNamespace;
    const math = element.namespaceURI === mathNamespace;
    if (svg || math) {
      if (!(svg ? svgTags : mathTags).has(tag)) { element.remove(); continue; }
      for (const attr of [...element.attributes]) {
        const name = attr.localName.toLowerCase();
        if (name.startsWith('on') || name === 'src' || attr.name === 'xml:base' ||
            (name === 'href' && (!svg || !/^#[^\s]+$/.test(attr.value)))) element.removeAttributeNode(attr);
      }
      if (element.hasAttribute('style')) {
        element.setAttribute('style', await rewriteCSS(element.getAttribute('style'), base, assets));
      }
      continue;
    }
    if (!allowedTags.has(tag) || element.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      element.replaceWith(...element.childNodes);
      continue;
    }
    const inlineCSS = element.getAttribute('style');
    const href = tag === 'a' ? element.getAttribute('href') : null;
    const media = ['audio', 'video', 'source', 'track'].includes(tag);
    const mediaSrc = media ? element.getAttribute('src') : null;
    const poster = tag === 'video' ? element.getAttribute('poster') : null;
    for (const attr of [...element.attributes]) {
      if (!allowedAttrs.has(attr.name) && !attr.name.startsWith('aria-') && !layoutData.test(attr.name)) element.removeAttributeNode(attr);
    }
    if (tag === 'input') {
      const type = (element.getAttribute('type') || 'text').toLowerCase();
      if (!['radio', 'checkbox', 'button', 'submit', 'reset', 'range', 'color'].includes(type)) {
        element.removeAttribute('value');
      }
    }
    if (tag === 'textarea') element.textContent = '';
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
    if (media) {
      if (!saveMedia) { element.remove(); continue; }
      if (tag === 'audio' || tag === 'video') {
        element.setAttribute('controls', '');
        element.setAttribute('preload', 'none');
      }
      if (mediaSrc) {
        const data = await assets.get(mediaSrc, base);
        if (data) element.setAttribute('src', data);
      }
      if (poster) {
        const data = await assets.get(poster, base);
        if (data) element.setAttribute('poster', data);
      }
    }
    if (imageData.has(element)) element.setAttribute('src', imageData.get(element));
  }
  const csp = "default-src 'none'; img-src data:; media-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
  const output = '<!doctype html><html' + (wrappers.html?.outerHTML.slice(4, -7) || '') + '><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp +
    '"><meta name="viewport" content="width=device-width,initial-scale=1">' + styles.join('') +
    '</head><body' + (wrappers.body?.outerHTML.slice(4, -7) || '') + '>' + template.innerHTML + '</body></html>';
  return {title, html: output, links: [...links]};
}

async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function run({mode, action, root, live, saveMedia = false, removeAds = false}) {
  const origin = new URL(root).origin;
  const id = mode === 'site' ? 'site:' + origin : 'page:' + root;
  const previous = await getArchive(id);
  if (action === 'check' && !previous) throw new Error('Save this archive before checking for changes.');
  const allowed = mode === 'site' ? await robotsRules(origin) : () => true;
  if (action === 'check') {
    saveMedia = previous.saveMedia ?? true;
    removeAds = previous.removeAds === true;
  }
  const assets = assetsFor(origin, allowed, saveMedia);
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
      const copy = await snapshot(html, url, assets, saveMedia, removeAds);
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
  job.resourceReasons = assets.reasons;
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
    id, root, mode, origin, saveMedia, removeAds, savedAt, title: pages[0].title, bytes, count: pages.length, byURL,
    skipped: failures.length, skippedAssets: assets.skipped, resourceReasons: assets.reasons, assets: assets.fetched, capped
  }, pages);
  job.outcome = 'saved';
  job.phase = pages.length + (pages.length === 1 ? ' page saved' : ' pages saved') + ' for offline use.' + (assets.skipped ? ' Skipped resources: ' + Object.entries(assets.reasons).map(([reason, count]) => count + ' ' + reason).join(' · ') + '.' : '');
}
