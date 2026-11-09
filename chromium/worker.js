import {hasPage, hostPermission, pageURL} from './db.js';

const offscreenURL = chrome.runtime.getURL('capture.html');
const popupURL = chrome.runtime.getURL('popup.html');
const latestNavigation = new Map();
const networkErrors = new Set([
  'net::ERR_INTERNET_DISCONNECTED', 'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_CONNECTION_TIMED_OUT', 'net::ERR_CONNECTION_REFUSED',
  'net::ERR_ADDRESS_UNREACHABLE', 'net::ERR_NETWORK_CHANGED',
  'net::ERR_PROXY_CONNECTION_FAILED', 'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_CLOSED', 'net::ERR_TIMED_OUT', 'net::ERR_NETWORK_IO_SUSPENDED'
]);
const filters = {url: [{schemes: ['http', 'https']}]};

chrome.webNavigation.onBeforeNavigate.addListener(event => {
  if (event.frameId === 0) latestNavigation.set(event.tabId, event.timeStamp);
});
chrome.tabs.onRemoved.addListener(tabId => latestNavigation.delete(tabId));
chrome.webNavigation.onErrorOccurred.addListener(async event => {
  if (event.frameId !== 0 || !networkErrors.has(event.error)) return;
  const started = latestNavigation.get(event.tabId);
  try {
    if ((started && started > event.timeStamp) || !await hasPage(event.url) ||
        latestNavigation.get(event.tabId) !== started) return;
    await chrome.tabs.update(event.tabId, {url: offlineURL(event.url)});
  } catch (error) {
    console.debug('CacheBuddy offline navigation', error);
  }
}, filters);

function offlineURL(url, archive) {
  const query = new URLSearchParams({url});
  if (archive) query.set('archive', archive);
  return chrome.runtime.getURL('viewer.html') + '?' + query;
}

let starting = false;
let permissionQueue = Promise.resolve();
let launchError = null;
const pendingKey = 'pendingCapture';
const permissionWindow = 5 * 60_000;

function serializePermission(task) {
  const operation = permissionQueue.then(task);
  permissionQueue = operation.catch(() => {});
  return operation;
}

async function resumeCapture() {
  const {[pendingKey]: intent} = await chrome.storage.session.get(pendingKey);
  if (!intent) return;
  if (Date.now() - intent.createdAt > permissionWindow) {
    await chrome.storage.session.remove(pendingKey);
    return;
  }
  const origins = (intent.saveMedia || intent.saveScripts) ? ['https://*/*', 'http://*/*'] : [hostPermission(intent.root)];
  if (!await chrome.permissions.contains({origins})) return;
  await chrome.storage.session.remove(pendingKey);
  try {
    await start(intent);
  } catch (error) {
    launchError = {root: intent.root, mode: intent.mode, action: intent.action,
      outcome: 'error', phase: error.message, running: false, done: 0, total: 1};
    throw error;
  }
}

chrome.permissions.onAdded.addListener(({origins}) => {
  if (origins?.length) serializePermission(resumeCapture).catch(console.error);
});

async function currentJob() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenURL]
  });
  if (!contexts.length) return null;
  return chrome.runtime.sendMessage({to: 'capture', type: 'status'});
}

async function start(message) {
  if (starting) throw new Error('Another archive operation is already running.');
  starting = true;
  try {
    const {mode, action, tabId} = message;
    const root = pageURL(message.root);
    if (!root || !['page', 'site'].includes(mode) || !['save', 'check'].includes(action)) {
      throw new Error('Choose an HTTP or HTTPS page.');
    }
    if (!await chrome.permissions.contains({origins: (message.saveMedia || message.saveScripts) ? ['https://*/*', 'http://*/*'] : [hostPermission(root)]})) {
      throw new Error('Allow access to this site to continue.');
    }
    const job = await currentJob();
    if (job?.running) throw new Error('Another archive operation is already running.');
    let live = null;
    if (mode === 'page') {
      try {
        const [injection] = await chrome.scripting.executeScript({
          target: {tabId},
          func: limit => {
            const copy = document.documentElement.cloneNode(true);
            const images = document.images;
            copy.querySelectorAll('img').forEach((image, index) => {
              if (images[index]?.currentSrc) {
                image.setAttribute('src', images[index].currentSrc);
                image.removeAttribute('srcset');
              }
            });
            const toggles = document.querySelectorAll('input[type=radio],input[type=checkbox]');
            copy.querySelectorAll('input[type=radio],input[type=checkbox]').forEach((input, index) => {
              input.toggleAttribute('checked', Boolean(toggles[index]?.checked));
            });
            const options = document.querySelectorAll('option');
            copy.querySelectorAll('option').forEach((option, index) => {
              option.toggleAttribute('selected', Boolean(options[index]?.selected));
            });
            for (const sheet of document.adoptedStyleSheets || []) {
              if (sheet.disabled) continue;
              const style = document.createElement('style');
              style.media = sheet.media.mediaText;
              style.textContent = Array.from(sheet.cssRules, rule => rule.cssText).join('\n');
              copy.querySelector('head')?.append(style);
            }
            const html = copy.outerHTML;
            return {url: location.href, html: html.length <= limit ? html : null};
          },
          args: [2_000_000]
        });
        if (pageURL(injection?.result?.url) === root) live = injection.result.html;
      } catch {
        // A public fetch still works when Chrome disallows injection.
      }
    }
    if (!job && !(await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']})).length) {
      await chrome.offscreen.createDocument({
        url: 'capture.html', reasons: ['DOM_PARSER'],
        justification: 'Parse and sanitize user-requested offline snapshots while the popup is closed.'
      });
    }
    const response = await chrome.runtime.sendMessage({to: 'capture', type: 'start', mode, action, root, live, saveMedia: message.saveMedia === true, removeAds: message.removeAds === true, saveScripts: message.saveScripts === true, uncapped: message.uncapped === true});
    if (!response?.ok) throw new Error(response?.error || 'The archive operation did not start.');
    return response;
  } finally {
    starting = false;
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message.to !== 'worker') return;
  if (message.type === 'asset-permission') {
    if (sender.id !== chrome.runtime.id || sender.tab || sender.url !== offscreenURL) return;
    const url = pageURL(message.url);
    if (!url) { reply({ok: true, granted: false}); return; }
    chrome.permissions.contains({origins: [hostPermission(url)]}).then(
      granted => reply({ok: true, granted}),
      error => reply({ok: false, error: error.message})
    );
    return true;
  }
  if (sender.url !== popupURL) return;
  let operation;
  if (message.type === 'cancel') operation = chrome.runtime.sendMessage({to: 'capture', type: 'cancel'});
  if (message.type === 'status') operation = currentJob().then(value => ({ok: true, job: value?.running ? value : launchError || value}));
  if (message.type === 'stage') operation = serializePermission(async () => {
    const {id, mode, action, tabId} = message;
    const root = pageURL(message.root);
    if (!root || typeof id !== 'string' || !['page', 'site'].includes(mode) || !['save', 'check'].includes(action)) {
      throw new Error('Choose an HTTP or HTTPS page.');
    }
    launchError = null;
    await chrome.storage.session.set({[pendingKey]: {id, mode, action, tabId, root, saveMedia: message.saveMedia === true, removeAds: message.removeAds === true, saveScripts: message.saveScripts === true, uncapped: message.uncapped === true, createdAt: Date.now()}});
    await resumeCapture();
    return {ok: true};
  });
  if (message.type === 'permission-result') operation = serializePermission(async () => {
    const {[pendingKey]: intent} = await chrome.storage.session.get(pendingKey);
    if (intent?.id === message.id) {
      if (message.granted) await resumeCapture();
      else await chrome.storage.session.remove(pendingKey);
    }
    return {ok: true};
  });
  if (message.type === 'open' && pageURL(message.url)) {
    operation = chrome.tabs.create({url: offlineURL(message.url, message.archive)}).then(() => ({ok: true}));
  }
  if (!operation) return;
  operation.then(reply, error => reply({ok: false, error: error.message}));
  return true;
});
