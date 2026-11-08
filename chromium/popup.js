import {hostPermission, listArchives, pageURL, writeArchive} from './db.js';
import {applyTheme} from './theme.js';

const el = id => document.getElementById(id);
const send = (type, values = {}) => chrome.runtime.sendMessage({to: 'worker', type, ...values});
let records = [], job, tab, root, origin, activeView = 'capture', pending = false, editing = false;
let previousJob, confirming = null;
const selectedMode = () => document.querySelector('input[name="mode"]:checked').value;
const pageArchive = () => records.find(record => record.id === 'page:' + root);
const siteArchive = () => records.find(record => record.id === 'site:' + origin);
const selectedArchive = () => selectedMode() === 'page' ? pageArchive() : siteArchive();
const number = new Intl.NumberFormat(undefined, {maximumFractionDigits: 1});

function size(bytes) {
  return bytes < 1_000_000 ? number.format(bytes / 1000) + ' kB' : number.format(bytes / 1_000_000) + ' MB';
}

function status(message, error = false) {
  const node = el('status');
  if (node.textContent !== message) node.textContent = message;
  node.dataset.error = String(error);
}

function renderCapture() {
  const mode = selectedMode(), archive = selectedArchive();
  const work = pending || job?.running;
  const page = pageArchive(), site = siteArchive();
  const inSite = site && Object.hasOwn(site.byURL, root);
  el('cacheState').hidden = !root;
  el('pageState').textContent = page ? 'Cached separately' : inSite ? 'Included in website cache' : 'Not cached';
  el('siteState').textContent = site
    ? 'Cached · ' + site.count + (site.count === 1 ? ' page' : ' pages')
    : 'Not cached';
  el('choices').disabled = !root || work;
  el('save').disabled = !root || work;
  el('check').disabled = work;
  el('check').hidden = !archive;
  const uncache = archive || site;
  const confirm = Boolean(uncache && confirming === uncache.id);
  el('uncache').hidden = !uncache;
  el('uncache').disabled = work;
  el('uncache').textContent = (confirm ? 'Confirm uncache ' : 'Uncache ') + (uncache?.mode === 'site' ? 'website' : 'page');
  el('cancelUncache').hidden = !confirm;
  el('cancelUncache').disabled = work;
  el('save').textContent = (archive ? 'Update ' : 'Cache ') + (mode === 'page' ? 'page' : 'website');
  el('scopeNote').textContent = mode === 'page' ?
    'Copies stay in this Chrome profile. A snapshot may include personal information visible in the tab.' :
    'Crawls public HTML on this origin without signing in. Copies stay in this Chrome profile.';
  const relevant = job && job.mode === mode &&
    (mode === 'page' ? job.root === root : new URL(job.root).origin === origin);
  const showMeter = Boolean(job?.running || (relevant && (archive || job.outcome === 'error')));
  el('meter').hidden = !showMeter;
  if (showMeter) {
    el('progress').max = job.total || 1;
    el('progress').value = job.done || 0;
    el('meterLabel').textContent = job.running ? job.phase : job.action === 'check' ? 'Check complete' : 'Capture progress';
    el('count').textContent = job.done + ' / ' + job.total + (job.total === 1 ? ' page' : ' pages');
  }
  if (!root) return status('Open an HTTP or HTTPS page to use CacheBuddy.');
  if (editing) return;
  if (job?.running) return status(job.mode === 'site' ? 'You can close this popup while the site is processed.' : '');
  if (relevant && job.outcome && (archive || job.outcome === 'error')) {
    const skipped = [job.skipped && job.skipped + ' pages skipped', job.skippedAssets && job.skippedAssets + ' unique resources skipped', job.capped && 'site limit reached'].filter(Boolean);
    return status(job.phase + (skipped.length ? ' ' + skipped.join(' · ') + '.' : ''), job.outcome === 'error');
  }
  status(archive ? 'Saved ' + new Date(archive.savedAt).toLocaleString() + '.' : '');
}

async function refresh() {
  records = (await listArchives()).sort((a, b) => b.savedAt - a.savedAt);
  if (activeView === 'archive') renderList();
}

function renderList() {
  el('total').textContent = records.length ?
    records.length + (records.length === 1 ? ' archive' : ' archives') + ' · ' + size(records.reduce((sum, record) => sum + record.bytes, 0)) :
    'Your offline copies will appear here.';
  const query = el('search').value.trim().toLowerCase();
  const visible = records.filter(record => (record.title + ' ' + record.root).toLowerCase().includes(query));
  el('list').replaceChildren();
  if (query && !visible.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No saved copies match your search.';
    el('list').append(empty);
  }
  for (const record of visible) {
    const row = document.createElement('li');
    const title = document.createElement('button');
    title.className = 'archive-title clip';
    title.textContent = record.title;
    title.title = record.root;
    title.addEventListener('click', () => send('open', {url: record.root, archive: record.id}).catch(console.error));
    const meta = document.createElement('span');
    meta.className = 'archive-meta muted small clip';
    meta.textContent = new URL(record.root).host + ' · ' + record.count + (record.count === 1 ? ' page · ' : ' pages · ') + size(record.bytes);
    const details = document.createElement('details');
    details.className = 'archive-detail';
    const summary = document.createElement('summary');
    summary.textContent = 'Manage copy';
    const address = document.createElement('a');
    address.href = record.root;
    address.target = '_blank';
    address.rel = 'noopener noreferrer';
    address.textContent = 'Visit original';
    const remove = document.createElement('button');
    remove.textContent = 'Delete';
    remove.disabled = Boolean(job?.running);
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.hidden = true;
    function cancelDelete() {
      cancel.hidden = true;
      remove.textContent = 'Delete';
    }
    cancel.addEventListener('click', () => {
      cancelDelete();
      remove.focus();
    });
    details.addEventListener('toggle', () => { if (!details.open) cancelDelete(); });
    remove.addEventListener('click', async () => {
      if (job?.running || pending) return;
      if (cancel.hidden) {
        remove.textContent = 'Confirm delete';
        cancel.hidden = false;
        return;
      }
      remove.disabled = true;
      try {
        await writeArchive(record.id);
        if (job?.root === record.root && job.mode === record.mode) job = null;
        await refresh();
      } catch (error) {
        el('total').textContent = 'Could not delete the archive. ' + error.message;
        remove.disabled = false;
      }
    });
    const date = document.createElement('p');
    date.className = 'muted';
    date.textContent = 'Saved ' + new Date(record.savedAt).toLocaleString();
    details.append(summary, remove, cancel, address, date);
    row.append(title, meta, details);
    el('list').append(row);
  }
}

for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => {
    activeView = button.dataset.view;
    for (const item of document.querySelectorAll('[data-view]')) {
      const active = item === button;
      if (active) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
      el(item.dataset.view).hidden = !active;
    }
    if (activeView === 'archive') renderList();
  });
}

async function start(action) {
  if (!root || pending || job?.running) return;
  const mode = selectedMode();
  const archive = selectedArchive();
  confirming = null;
  const saveMedia = action === 'check' ? (archive?.saveMedia ?? true) : el('saveMedia').checked;
  const removeAds = action === 'check' ? archive?.removeAds === true : el('removeAds').checked;
  const source = mode === 'site' && archive ? archive.root : root;
  pending = true;
  editing = false;
  renderCapture();
  try {
    const id = crypto.randomUUID();
    // Stage the click before the permission prompt can dismiss this popup.
    const staged = send('stage', {id, mode, action, root: source, tabId: tab.id, saveMedia, removeAds});
    const permission = chrome.permissions.request({origins: saveMedia ? ['https://*/*', 'http://*/*'] : [hostPermission(source)]});
    const [stage, grant] = await Promise.allSettled([staged, permission]);
    if (stage.status === 'rejected') throw stage.reason;
    if (!stage.value?.ok) throw new Error(stage.value?.error || 'Could not start the operation.');
    const granted = grant.status === 'fulfilled' && grant.value;
    const response = await send('permission-result', {id, granted});
    if (!response?.ok) throw new Error(response?.error || 'Could not start the operation.');
    if (grant.status === 'rejected') throw grant.reason;
    if (!granted) throw new Error('Site access was declined. No data was saved.');
    await poll();
  } catch (error) {
    editing = true;
    status(error.message, true);
  } finally {
    pending = false;
    renderCapture();
  }
}

let polling = false;
async function poll() {
  if (polling) return;
  polling = true;
  try {
    const response = await send('status');
    if (!response?.ok) throw new Error(response?.error || 'Could not read the cache status.');
    job = response.job;
    const fingerprint = JSON.stringify(job && [job.root, job.mode, job.action, job.outcome, job.running]);
    if (fingerprint !== previousJob) {
      if (job?.running) editing = false;
      previousJob = fingerprint;
      if (!job?.running) await refresh();
      else if (activeView === 'archive') renderList();
    }
    renderCapture();
  } catch (error) {
    editing = true;
    status(error.message, true);
  } finally {
    polling = false;
  }
}

el('removeAds').addEventListener('change', () => {
  chrome.storage.local.set({removeAds: el('removeAds').checked}).catch(error => status(error.message, true));
});

el('saveMedia').addEventListener('change', () => {
  chrome.storage.local.set({saveMedia: el('saveMedia').checked}).catch(error => status(error.message, true));
});

el('save').addEventListener('click', () => start('save'));
el('check').addEventListener('click', () => start('check'));
el('choices').addEventListener('change', () => {
  confirming = null;
  editing = false;
  renderCapture();
});
el('cancelUncache').addEventListener('click', () => {
  confirming = null;
  renderCapture();
  el('uncache').focus();
});
el('uncache').addEventListener('click', async () => {
  if (pending || job?.running) return;
  const site = siteArchive();
  const archive = selectedArchive() || site;
  if (!archive) return;
  if (confirming !== archive.id) {
    confirming = archive.id;
    renderCapture();
    return;
  }
  pending = true;
  confirming = null;
  renderCapture();
  try {
    await writeArchive(archive.id);
    await refresh();
    editing = true;
    status(archive.mode === 'site' ? 'Website cache removed.' : 'Page cache removed.');
  } catch (error) {
    editing = true;
    status(error.message, true);
  } finally {
    pending = false;
    renderCapture();
    el('save').focus();
  }
});
el('search').addEventListener('input', renderList);
el('theme').addEventListener('change', async event => {
  await chrome.storage.local.set({theme: event.target.value});
  await applyTheme();
});

try {
  document.body.style.setProperty('--popup-width', Math.round(screen.availWidth / 3) + 'px');
  el('theme').value = await applyTheme();
  const preferences = await chrome.storage.local.get(['saveMedia', 'removeAds']);
  el('saveMedia').checked = preferences.saveMedia !== false;
  el('removeAds').checked = preferences.removeAds === true;
  [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  const address = tab?.url || '';
  const viewer = address.startsWith(chrome.runtime.getURL('viewer.html') + '?');
  root = pageURL(viewer ? new URL(address).searchParams.get('url') : address);
  origin = root ? new URL(root).origin : null;
  el('host').textContent = root ? new URL(root).host : 'No web page selected';
  el('address').textContent = root || '';
  el('address').title = root || '';
  await refresh();
  renderCapture();
  await poll();
  setInterval(poll, 500);
} catch (error) {
  status(error.message, true);
}
