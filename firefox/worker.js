import {hasPage, hostPermission, pageURL} from './db.js';

import {beginCapture, captureStatus, cancelCapture} from './capture.js';
const popupURL = browser.runtime.getURL('popup.html');
const latestNavigation = new Map();
const networkErrors = new Set([
  'net::ERR_INTERNET_DISCONNECTED', 'net::ERR_NAME_NOT_RESOLVED',
  'net::ERR_CONNECTION_TIMED_OUT', 'net::ERR_CONNECTION_REFUSED',
  'net::ERR_ADDRESS_UNREACHABLE', 'net::ERR_NETWORK_CHANGED',
  'net::ERR_PROXY_CONNECTION_FAILED', 'net::ERR_CONNECTION_RESET',
  'net::ERR_CONNECTION_CLOSED', 'net::ERR_TIMED_OUT', 'net::ERR_NETWORK_IO_SUSPENDED',
  'NS_ERROR_OFFLINE', 'NS_ERROR_UNKNOWN_HOST', 'NS_ERROR_UNKNOWN_PROXY_HOST',
  'NS_ERROR_CONNECTION_REFUSED', 'NS_ERROR_PROXY_CONNECTION_REFUSED',
  'NS_ERROR_NET_TIMEOUT', 'NS_ERROR_NET_RESET', 'NS_ERROR_NET_INTERRUPT'
]);
const filters = {url: [{schemes: ['http', 'https']}]};

browser.webNavigation.onBeforeNavigate.addListener(event => {
  if (event.frameId === 0) latestNavigation.set(event.tabId, event.timeStamp);
});
browser.tabs.onRemoved.addListener(tabId => latestNavigation.delete(tabId));
browser.webNavigation.onErrorOccurred.addListener(async event => {
  if (event.frameId !== 0 || !networkErrors.has(event.error)) return;
  const started = latestNavigation.get(event.tabId);
  try {
    if ((started && started > event.timeStamp) || !await hasPage(event.url) ||
        latestNavigation.get(event.tabId) !== started) return;
    await browser.tabs.update(event.tabId, {url: offlineURL(event.url)});
  } catch (error) {
    console.debug('CacheBuddy offline navigation', error);
  }
}, filters);

function offlineURL(url, archive) {
  const query = new URLSearchParams({url});
  if (archive) query.set('archive', archive);
  return browser.runtime.getURL('viewer.html') + '?' + query;
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
  const {[pendingKey]: intent} = await browser.storage.session.get(pendingKey);
  if (!intent) return;
  if (Date.now() - intent.createdAt > permissionWindow) {
    await browser.storage.session.remove(pendingKey);
    return;
  }
  const origins = (intent.saveMedia || intent.saveScripts) ? ['https://*/*', 'http://*/*'] : [hostPermission(intent.root)];
  if (!await browser.permissions.contains({origins})) return;
  await browser.storage.session.remove(pendingKey);
  try {
    await start(intent);
  } catch (error) {
    launchError = {root: intent.root, mode: intent.mode, action: intent.action,
      outcome: 'error', phase: error.message, running: false, done: 0, total: 1};
    throw error;
  }
}

browser.permissions.onAdded.addListener(({origins}) => {
  if (origins?.length) serializePermission(resumeCapture).catch(console.error);
});

async function start(message) {
  if (starting) throw new Error('Another archive operation is already running.');
  starting = true;
  try {
    const {mode, action, tabId} = message;
    const root = pageURL(message.root);
    if (!root || !['page', 'site'].includes(mode) || !['save', 'check'].includes(action)) {
      throw new Error('Choose an HTTP or HTTPS page.');
    }
    if (!await browser.permissions.contains({origins: (message.saveMedia || message.saveScripts) ? ['https://*/*', 'http://*/*'] : [hostPermission(root)]})) {
      throw new Error('Allow access to this site to continue.');
    }
    const job = captureStatus();
    if (job?.running) throw new Error('Another archive operation is already running.');
    let live = null;
    if (mode === 'page') {
      try {
        const [injection] = await browser.scripting.executeScript({
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
        // A public fetch still works when Firefox disallows injection.
      }
    }
    const response = beginCapture({mode, action, root, live, saveMedia: message.saveMedia === true, removeAds: message.removeAds === true, saveScripts: message.saveScripts === true, uncapped: message.uncapped === true});
    if (!response?.ok) throw new Error(response?.error || 'The archive operation did not start.');
    return response;
  } finally {
    starting = false;
  }
}

browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.url !== popupURL || message.to !== 'worker') return;
  let operation;
  if (message.type === 'cancel') return Promise.resolve(cancelCapture());
  if (message.type === 'status') {
    const value = captureStatus();
    return Promise.resolve({ok: true, job: value?.running ? value : launchError || value});
  }
  if (message.type === 'stage') operation = serializePermission(async () => {
    const {id, mode, action, tabId} = message;
    const root = pageURL(message.root);
    if (!root || typeof id !== 'string' || !['page', 'site'].includes(mode) || !['save', 'check'].includes(action)) {
      throw new Error('Choose an HTTP or HTTPS page.');
    }
    launchError = null;
    await browser.storage.session.set({[pendingKey]: {id, mode, action, tabId, root, saveMedia: message.saveMedia === true, removeAds: message.removeAds === true, saveScripts: message.saveScripts === true, uncapped: message.uncapped === true, createdAt: Date.now()}});
    await resumeCapture();
    return {ok: true};
  });
  if (message.type === 'permission-result') operation = serializePermission(async () => {
    const {[pendingKey]: intent} = await browser.storage.session.get(pendingKey);
    if (intent?.id === message.id) {
      if (message.granted) await resumeCapture();
      else await browser.storage.session.remove(pendingKey);
    }
    return {ok: true};
  });
  if (message.type === 'open' && pageURL(message.url)) {
    operation = browser.tabs.create({url: offlineURL(message.url, message.archive)}).then(() => ({ok: true}));
  }
  return operation?.catch(error => ({ok: false, error: error.message}));
});
