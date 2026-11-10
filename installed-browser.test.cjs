const assert = require('node:assert/strict');
const {createServer} = require('node:http');
const {mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, resolve} = require('node:path');
const {execFileSync} = require('node:child_process');
const browser = process.argv[2];
const temp = mkdtempSync(join(tmpdir(), 'cachebuddy-test-'));
const source = join(temp, 'extension');
cpSync(resolve(browser), source, {recursive: true});
const manifestPath = join(source, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath));
// Grant access to the local fixture in the test profile only.
if (browser === 'chromium') manifest.host_permissions = ['http://127.0.0.1/*'];
else manifest.permissions.push('http://127.0.0.1/*');
writeFileSync(manifestPath, JSON.stringify(manifest));

let hits = 0;
const server = createServer((req, res) => {
  if (req.url === '/widget.js') {
    res.setHeader('Content-Type', 'application/javascript');
    return res.end("document.querySelector('button').onclick = () => document.querySelector('output').textContent = 'worked';");
  }
  if (req.url === '/blocked') { hits++; return res.end('blocked'); }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><title>CacheBuddy test</title><main><h1>Offline fixture</h1><button>Run fixture</button><output>initial</output><script src="/widget.js"></script><script>fetch("http://127.0.0.1:' + server.address().port + '/blocked").catch(() => {}); try { parent.document.body.dataset.unsafe="1" } catch { document.body.dataset.isolated="yes" }</script></main>');
});

async function wait(operation, reason) {
  const end = Date.now() + 15000;
  do {
    const result = await operation();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < end);
  throw new Error(reason);
}

async function verifyPopup(evaluate, navigate, popupURL) {
  await navigate(popupURL);
  await wait(() => evaluate(() => Boolean(document.querySelector('#host')?.textContent !== 'Loading…')), 'Popup initialization timed out');
  // Toolbar popups can start with a tiny viewport while the browser measures the document.
  const layout = await evaluate(async () => {
    const preview = document.createElement('iframe');
    preview.style.cssText = 'position:absolute;width:32px;height:32px;visibility:hidden';
    const loaded = new Promise(resolve => preview.addEventListener('load', resolve, {once: true}));
    preview.src = location.href;
    document.body.append(preview);
    await loaded;
    try {
      const popup = preview.contentDocument;
      const frame = popup.querySelector('.frame');
      const meter = popup.getElementById('meter');
      const path = popup.getElementById('meterLabel');
      const stop = popup.getElementById('stop');
      meter.hidden = false;
      stop.hidden = false;
      path.textContent = 'Saving /' + 'long-path-segment/'.repeat(100) + 'index.html';
      popup.getElementById('count').textContent = '19 / 40 pages';
      const stopBefore = stop.getBoundingClientRect().right;
      path.scrollLeft = path.scrollWidth;
      const footerBefore = meter.getBoundingClientRect().bottom;
      frame.scrollTop = frame.scrollHeight;
      return {
        width: popup.body.offsetWidth,
        height: popup.body.offsetHeight,
        panelHeight: frame.clientHeight,
        pathScrolled: path.scrollLeft > 0,
        stopBefore,
        stopAfter: stop.getBoundingClientRect().right,
        footerBefore,
        footerAfter: meter.getBoundingClientRect().bottom
      };
    } finally {
      preview.remove();
    }
  });
  assert(layout.width >= 448 && layout.height === 600 && layout.panelHeight > 0, JSON.stringify(layout));
  assert(layout.pathScrolled && layout.stopBefore > 0 && layout.stopBefore <= layout.width, JSON.stringify(layout));
  assert.equal(layout.stopAfter, layout.stopBefore);
  assert(Math.abs(layout.footerBefore - layout.height) < 1, JSON.stringify(layout));
  assert.equal(layout.footerAfter, layout.footerBefore);
  const controls = await evaluate(() => {
    const captureOptions = document.getElementById('captureOptions');
    const options = [...captureOptions.querySelectorAll('input')].map(e => e.id);
    const optionsAboveNote = captureOptions.parentElement.id === 'capture' &&
      captureOptions.nextElementSibling.id === 'scopeNote';
    document.getElementById('uncapped').click();
    document.querySelector('[data-view=settings]').click();
    const theme = document.querySelector('#theme');
    theme.value = 'ink';
    theme.dispatchEvent(new Event('change'));
    const settings = document.getElementById('settings');
    return {options, optionsAboveNote, nav: [...document.querySelectorAll('[data-view]')].map(b => b.dataset.view), visible: settings.contains(theme) && !settings.hidden};
  });
  assert.deepEqual(controls.options, ['saveMedia', 'removeAds', 'saveScripts', 'uncapped']);
  assert(controls.optionsAboveNote);
  assert.deepEqual(controls.nav, ['capture', 'archive', 'settings', 'about']);
  assert(controls.visible);
  await wait(() => evaluate(async () => {
    const {theme, uncapped} = await (globalThis.browser ?? chrome).storage.local.get(['theme', 'uncapped']);
    return theme === 'ink' && uncapped === true && document.documentElement.dataset.theme === 'ink';
  }), 'Settings were not persisted and applied');
  await navigate(popupURL);
  await wait(() => evaluate(() => document.getElementById('uncapped').checked && document.getElementById('theme').value === 'ink'), 'Settings did not survive reopening');
}

async function verifyPage(evaluate, navigate, extension, root, frame) {
  await navigate(extension + '/viewer.html?url=' + encodeURIComponent(root));
  await wait(() => evaluate(() => document.querySelector('#copy').contentDocument?.querySelector('h1')?.textContent === 'Offline fixture'), 'Saved copy did not open');
  assert.equal(await evaluate(() => document.querySelector('#copy').contentDocument.querySelector('output').textContent), 'initial');
  await evaluate(() => document.getElementById('replay').click());
  await frame();
  assert.equal(await evaluate(() => document.body.dataset.unsafe || null), null);
  assert.equal(hits, 0);
}

async function chromiumTest(root) {
  const {chromium} = require('playwright');
  const context = await chromium.launchPersistentContext(join(temp, 'profile'), {
    channel: 'chromium', headless: true,
    args: ['--disable-extensions-except=' + source, '--load-extension=' + source]
  });
  try {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const extension = worker.url().split('/').slice(0, 3).join('/');
    const page = context.pages()[0] || await context.newPage();
    const evalPage = fn => page.evaluate(fn);
    const navigate = url => page.goto(url);
    await verifyPopup(evalPage, navigate, extension + '/popup.html');
    const started = await worker.evaluate(async root => {
      await chrome.offscreen.createDocument({url:'capture.html', reasons:['DOM_PARSER'], justification:'Test installed capture'});
      return chrome.runtime.sendMessage({to:'capture',type:'start',mode:'page',action:'save',root,saveScripts:true});
    }, root);
    assert(started?.ok);
    const result = await wait(() => worker.evaluate(async () => {
      const job = await chrome.runtime.sendMessage({to:'capture',type:'status'});
      return job?.running ? null : job;
    }), 'Chromium capture timed out');
    assert.equal(result.outcome, 'saved', result.phase);
    await context.setOffline(true);
    await verifyPage(evalPage, navigate, extension, root, async () => {
      const copy = page.frameLocator('#copy');
      await copy.locator('body[data-isolated=yes]').waitFor();
      await copy.getByRole('button',{name:'Run fixture'}).click();
      await copy.getByText('worked',{exact:true}).waitFor();
    });
  } finally { await context.close(); }
}

async function firefoxTest(root) {
  const {Builder, By} = require('selenium-webdriver');
  const firefox = require('selenium-webdriver/firefox');
  const uuid = 'daf9cab3-cfa3-426f-9ef3-76374c5120d5';
  const id = manifest.browser_specific_settings.gecko.id;
  const options = new firefox.Options().addArguments('-headless')
    .setPreference('extensions.webextensions.uuids', JSON.stringify({[id]:uuid}));
  if (process.env.CACHEBUDDY_FIREFOX) options.setBinary(process.env.CACHEBUDDY_FIREFOX);
  const service = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
  const navigate = async url => {
    await driver.setContext(firefox.Context.CHROME);
    try {
      await driver.executeScript(
        'gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()});', url);
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
    }
    await wait(() => driver.executeScript('return location.href === arguments[0] && document.readyState === "complete";', url)
      .catch(() => false), 'Firefox could not open the installed extension page');
  };
  const evalPage = fn => driver.executeAsyncScript('const done=arguments[arguments.length-1]; Promise.resolve().then(' + fn.toString() + ').then(value=>done(value??null),err=>done({error:String(err)}));').then(value => {
    if (value?.error) throw new Error(value.error);
    return value;
  });
  try {
    const xpi = join(temp, 'cachebuddy.xpi');
    execFileSync('zip', ['-qr', xpi, '.'], {cwd: source});
    assert.equal(await driver.installAddon(xpi, true), id);
    await driver.setContext(firefox.Context.CHROME);
    const extension = await driver.executeScript(
      'return "moz-extension://" + WebExtensionPolicy.getByID(arguments[0]).mozExtensionHostname;', id);
    await driver.setContext(firefox.Context.CONTENT);
    await verifyPopup(evalPage, navigate, extension + '/popup.html');
    await navigate(extension + '/capture.html');
    const result = await driver.executeAsyncScript(
      'const root=arguments[0], done=arguments[arguments.length-1];' +
      'import(new URL("capture.js",location.href).href).then(({beginCapture,captureStatus})=>{' +
      'const response=beginCapture({mode:"page",action:"save",root,saveScripts:true});' +
      'if(!response.ok)return done(response);const poll=setInterval(()=>{' +
      'const job=captureStatus();if(job&&!job.running){clearInterval(poll);done(job);}},100);' +
      '}).catch(error=>done({phase:String(error)}));', root);
    assert.equal(result.outcome, 'saved', result.phase);
    await new Promise(resolve => server.close(resolve));
    await verifyPage(evalPage, navigate, extension, root, async () => {
      await driver.switchTo().frame(await driver.findElement(By.id('copy')));
      await wait(() => driver.executeScript('return document.body.dataset.isolated === "yes"'), 'Firefox sandbox did not run the cached code');
      await driver.findElement(By.css('button')).click();
      assert.equal(await driver.findElement(By.css('output')).getText(), 'worked');
      await driver.switchTo().defaultContent();
    });
  } finally { await driver.quit(); }
}

(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const root = 'http://127.0.0.1:' + server.address().port + '/';
    await (browser === 'chromium' ? chromiumTest(root) : firefoxTest(root));
    console.log(browser + ': installed capture, offline playback, and persistent settings passed');
  } finally {
    server.close();
    rmSync(temp,{recursive:true,force:true});
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
