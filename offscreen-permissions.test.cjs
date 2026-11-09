const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = __dirname;
(async () => {
  let handler, granted = true, requests = 0;
  const noop = {addListener() {}};
  const chrome = {
    runtime: {id: 'test-extension', getURL: file => 'chrome-extension://test-extension/' + file,
      onMessage: {addListener(fn) {handler = fn}}},
    permissions: {onAdded: noop, contains: async () => granted},
    tabs: {onRemoved: noop}, webNavigation: {onBeforeNavigate: noop, onErrorOccurred: noop}
  };
  const pageURL = value => {try {const u = new URL(value);return /^https?:$/.test(u.protocol) ? u.href : null}catch{return null}};
  const hostPermission = value => new URL(value).origin + '/*';
  vm.runInNewContext(fs.readFileSync(path.join(root, 'chromium/worker.js'), 'utf8').replace(/^import .*\n/, ''),
    {chrome, URL, URLSearchParams, Map, Set, Date, console, pageURL, hostPermission});
  const sender = {id: chrome.runtime.id, url: chrome.runtime.getURL('capture.html')};
  const message = {to: 'worker', type: 'asset-permission', url: 'https://upload.wikimedia.org/image.png'};
  const call = (m, s = sender) => new Promise(resolve => {
    const result = handler(m, s, resolve);
    if (result !== true) resolve(undefined);
  });
  assert.equal((await call(message)).granted, true);
  granted = false;
  assert.equal((await call(message)).granted, false);
  assert.equal(await call(message, {...sender, url: 'https://en.wikipedia.org/'}), undefined);
  assert.equal(await call(message, {...sender, tab: {id: 1}}), undefined);
  assert.equal((await call({...message, url: 'file:///secret'})).granted, false);
  granted = true;
  // Reproduce Chrome's offscreen environment: runtime exists, permissions does not.
  const offscreen = {runtime: {id: chrome.runtime.id, onMessage: noop, sendMessage: m => call(m)}};
  assert.equal(offscreen.permissions, undefined);
  const source = fs.readFileSync(path.join(root, 'chromium/capture.js'), 'utf8').replace(/^import .*\n/, '');
  const context = vm.createContext({chrome: offscreen, URL, Set, Map, Blob, AbortSignal, console,
    webURL: (v, base) => {try {return new URL(v, base)} catch {return null}},
    fetch: async () => {requests++;return new Response('png', {headers: {'content-type': 'image/png'}})},
    FileReader: class {readAsDataURL(blob) {blob.arrayBuffer().then(bytes => {this.result = 'data:' + blob.type + ';base64,' + Buffer.from(bytes).toString('base64');this.onload()})}}
  });
  vm.runInContext(source + '\njob={};this.assetsFor=assetsFor;', context);
  const assets = context.assetsFor('https://en.wikipedia.org', () => true, true);
  assert.match(await assets.get(message.url, 'https://en.wikipedia.org'), /^data:image\/png;base64,/);
  assert.equal(requests, 1);
  granted = false;
  assert.equal(await assets.get('https://denied.example/image.png', 'https://en.wikipedia.org'), '');
  assert.equal(requests, 1);
  granted = true;
  assert.equal(await context.assetsFor('https://en.wikipedia.org', () => true, false).get(message.url, 'https://en.wikipedia.org'), '');
  assert.equal(requests, 1);
  const withoutMedia = context.assetsFor('https://en.wikipedia.org', () => true, false);
  assert.match(await withoutMedia.get(message.url, 'https://en.wikipedia.org', false, true), /^data:image\/png;base64,/);
  assert.equal(requests, 2);
  for (const browser of ['chromium', 'firefox']) {
    const popup = fs.readFileSync(path.join(root, browser, 'popup.js'), 'utf8');
    const expression = popup.match(/el\('saveMedia'\)\.checked = ([^;]+);/)[1];
    for (const [value, expected] of [[undefined,true], [true,true], [false,false]])
      assert.equal(vm.runInNewContext(expression, {preferences: {saveMedia: value}}), expected);
    const scripts = popup.match(/el\('saveScripts'\)\.checked = ([^;]+);/)[1];
    for (const [value, expected] of [[undefined,true], [true,true], [false,false]])
      assert.equal(vm.runInNewContext(scripts, {preferences: {saveScripts: value}}), expected);
    const limits = popup.match(/el\('uncapped'\)\.checked = ([^;]+);/)[1];
    for (const [value, expected] of [[undefined,false], [true,true], [false,false]])
      assert.equal(vm.runInNewContext(limits, {preferences: {uncapped: value}}), expected);
    const ads = popup.match(/el\('removeAds'\)\.checked = ([^;]+);/)[1];
    for (const [value, expected] of [[undefined,false], [true,true], [false,false]])
      assert.equal(vm.runInNewContext(ads, {preferences: {removeAds: value}}), expected);
  }
  console.log('PASS: offscreen runtime-only Wikimedia embedding, worker sender checks, denied access, media disabled, and default-on with preserved opt-out');
})().catch(error => {console.error(error);process.exitCode = 1});
