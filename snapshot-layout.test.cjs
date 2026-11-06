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
    const markup='<html class="client-js"><body><style>.cdx-radio__label{padding-left:24px}.cdx-radio__icon{position:absolute}</style><form action="https://bad.example"><div class="cdx-radio"><input id="standard" class="cdx-radio__input" name="appearance" type="radio" value="1" checked onclick="bad()"><span class="cdx-radio__icon"></span><label class="cdx-label cdx-radio__label" for="standard"><span class="cdx-label__label__text">Standard</span></label></div><input type="checkbox" id="toggle" checked><button formaction="https://bad.example" onclick="bad()">Hide</button><input type="password" value="secret"><input type="hidden" value="token"><input type="text" value="private"><script>bad()</script></form><img src="https://thumb.wikimedia.org/image.png"></body></html>';
    const copy=await context.snapshot(markup,'https://en.wikipedia.org/wiki/Test',{get:async()=> 'data:image/png;base64,aW1hZ2U=',noteSkipped(){}},true);
    const result=parseHTML(copy.html).document;
    const radio=result.querySelector('#standard');
    assert(radio.hasAttribute('disabled'));assert(radio.hasAttribute('checked'));
    assert(!radio.hasAttribute('value'));assert(!radio.hasAttribute('onclick'));
    assert.equal(result.querySelector('.cdx-radio__label').getAttribute('for'),'standard');
    assert.equal(result.querySelector('.cdx-radio__label').textContent,'Standard');
    assert(result.querySelector('#toggle').hasAttribute('checked'));
    assert(result.querySelector('button').hasAttribute('disabled'));
    assert.equal(result.querySelector('button').getAttribute('formaction'),null);
    assert.equal(result.querySelectorAll('form,script,input[type=password],input[type=hidden],input[type=text]').length,0);
    assert(!copy.html.includes('secret'));assert(!copy.html.includes('token'));assert(!copy.html.includes('private'));
    assert(result.querySelector('style').textContent.includes('.cdx-radio__label'));
    assert(result.querySelector('img').getAttribute('src').startsWith('data:'));
    console.log(browser+': PASS radio/label layout structure, checked state, disabled controls, stripped sensitive inputs/handlers, embedded images');
  }
})().catch(error=>{console.error(error);process.exitCode=1});
