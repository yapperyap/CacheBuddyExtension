const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {parseHTML} = require('linkedom');
(async () => {
  for (const browser of ['chromium', 'firefox']) {
    const {document} = parseHTML('<html></html>');
    // Linkedom serializes a separate template tree; use content after mutations, as browsers do.
    const create = document.createElement.bind(document);
    document.createElement = tag => {
      const node = create(tag);
      if (tag === 'template') {
        let proto=node, descriptor;
        while(proto&&!descriptor){descriptor=Object.getOwnPropertyDescriptor(proto,'innerHTML');proto=Object.getPrototypeOf(proto)}
        Object.defineProperty(node,'innerHTML',{get(){return [...node.content.childNodes].map(n=>n.toString()).join('')},set(value){descriptor.set.call(node,value)}});
      }
      return node;
    };
    const source = fs.readFileSync(path.join(__dirname,browser,'capture.js'),'utf8').replace(/^import .*\n/,'').replaceAll('export function','function');
    const context=vm.createContext({document,URL,Set,Map,console,chrome:{runtime:{onMessage:{addListener(){}}}},
      webURL:(value,base)=>{try{const u=new URL(value,base);return /^https?:$/.test(u.protocol)?u:null}catch{return null}},
      pageURL:(value,base)=>{try{const u=new URL(value,base);u.hash='';return u.href}catch{return null}}
    });
    vm.runInContext(source,context);
    const markup='<html class="client-js"><body><style>.cdx-radio__label{padding-left:24px}.cdx-radio__icon{position:absolute}</style><form action="https://bad.example"><div class="cdx-radio"><input id="standard" class="cdx-radio__input" name="appearance" type="radio" value="1" checked onclick="bad()"><span class="cdx-radio__icon"></span><label class="cdx-label cdx-radio__label" for="standard"><span class="cdx-label__label__text">Standard</span></label></div><input type="checkbox" id="toggle" checked><select><option selected>Standard</option></select><button formaction="https://bad.example" onclick="bad()">Hide</button><input type="password" value="secret"><input type="hidden" value="token"><input type="text" value="private"><script>bad()</script></form><svg viewBox="0 0 10 10" onload="bad()"><path d="M0 0h10v10"/><use href="#glyph"/><use href="https://bad.example/icon.svg#glyph"/></svg><ins class="adsbygoogle">Sponsored</ins><p class="advice">Article advice</p><img src="https://thumb.wikimedia.org/image.png"></body></html>';
    const copy=await context.snapshot(markup,'https://en.wikipedia.org/wiki/Test',{get:async()=> 'data:image/png;base64,aW1hZ2U=',noteSkipped(){}},true);
    const result=parseHTML(copy.html).document;
    const radio=result.querySelector('#standard');
    assert(!radio.hasAttribute('disabled'));assert(radio.hasAttribute('checked'));
    assert.equal(radio.getAttribute('name'), 'appearance');assert(!radio.hasAttribute('onclick'));
    assert.equal(result.querySelector('.cdx-radio__label').getAttribute('for'),'standard');
    assert.equal(result.querySelector('.cdx-radio__label').textContent,'Standard');
    assert(result.querySelector('#toggle').hasAttribute('checked'));
    assert(result.querySelector('select option').hasAttribute('selected'));
    assert(result.querySelector('input[type=text]'));
    assert.equal(result.querySelector('form').getAttribute('action'), null);
    assert.equal(result.querySelector('button').getAttribute('formaction'),null);
    assert.equal(result.querySelectorAll('script').length, 0);
    assert(result.querySelector('svg path'));
    assert(!result.querySelector('svg').hasAttribute('onload'));
    assert.equal(result.querySelectorAll('svg use[href]').length, 1);
    assert(result.querySelector('.adsbygoogle'));
    const filtered = await context.snapshot(markup, 'https://en.wikipedia.org/wiki/Test', {get: async () => '', noteSkipped() {}}, false, true);
    const filteredDocument = parseHTML(filtered.html).document;
    assert(!filteredDocument.querySelector('.adsbygoogle'));
    assert(filteredDocument.querySelector('.advice'));
    assert.match(filtered.html, /form-action 'none'/);
    assert(!copy.html.includes('secret'));assert(!copy.html.includes('token'));assert(!copy.html.includes('private'));
    assert(result.querySelector('style').textContent.includes('.cdx-radio__label'));
    assert(result.querySelector('img').getAttribute('src').startsWith('data:'));
    const scripted = '<div><script src="/widget.js"></script><script>showWidget()</script><script type="application/json">{"visible":true}</script></div>';
    const scriptResources = {get: async (url, base, kind) => {
      assert.equal(kind, 'script');
      assert.equal(url, '/widget.js');
      return {text: 'function showWidget() {}', url: new URL(url, base).href};
    }, noteSkipped() {}};
    const withScripts = await context.snapshot(scripted, 'https://example.org/', scriptResources, false, false, true);
    assert.deepEqual(Array.from(withScripts.scripts, entry => entry.text), ['function showWidget() {}', 'showWidget()', '{"visible":true}']);
    assert(!withScripts.html.includes('<script'));
    const withoutScripts = await context.snapshot(scripted, 'https://example.org/', scriptResources, false, false, false);
    assert.equal(withoutScripts.scripts.length, 0);
    let draft = new Map(), archive, stopAt = 0;
    Object.assign(context, {
      Blob, TextEncoder, crypto: require('node:crypto').webcrypto, AbortSignal,
      setTimeout: resolve => queueMicrotask(resolve),
      clearDraft: async () => draft.clear(),
      appendDraft: async page => {
        draft.set(page.url, page);
        if (draft.size === stopAt) assert(context.cancelCapture().ok);
      },
      getArchive: async () => archive,
      writeArchive: async (_id, record, pages, staged) => {
        archive = record;
        assert.equal(record.count, staged ? draft.size : pages.length);
      },
      fetch: async value => {
        const address = new URL(value);
        if (address.pathname === '/robots.txt') return new Response('User-agent: *');
        const links = Array.from({length: 44}, (_, index) => '<a href="/p/' + index + '">Page</a>').join('');
        return new Response('<title>Site fixture</title><main>' + links + '</main>', {headers: {'Content-Type': 'text/html'}});
      }
    });
    const runSite = uncapped => {
      vm.runInContext('job = {running: true, done: 0}', context);
      return context.run({mode: 'site', action: 'save', root: 'https://example.org/', uncapped});
    };
    await runSite(false);
    assert.equal(archive.count, 40);
    assert(archive.capped);
    await runSite(true);
    assert.equal(archive.count, 45);
    assert(!archive.capped);
    assert.equal(draft.size, 0);
    const previous = archive;
    stopAt = 3;
    await assert.rejects(runSite(true), /Capture stopped/);
    assert.equal(archive, previous);
    assert.equal(draft.size, 0);
    console.log(browser+': PASS radio/label layout structure, checked state, preserved controls and SVG, stripped sensitive values/handlers, opt-in ad removal, embedded images');
  }
})().catch(error=>{console.error(error);process.exitCode=1});
