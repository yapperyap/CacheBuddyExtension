const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
(async () => {
  for (const browser of ['chromium', 'firefox']) {
    let requests = 0, permissionChecks = 0, granted = true;
    const context = vm.createContext({URL, Blob, AbortSignal, TextEncoder, atob, Map, Set, console,
      chrome: {runtime: {onMessage: {addListener() {}}, sendMessage: async () => {permissionChecks++;return {ok:true,granted}}}},
      browser: {permissions: {contains: async () => {permissionChecks++;return granted}}},
      webURL: (value, base) => {try {const u=new URL(value,base);return /^https?:$/.test(u.protocol)?u:null}catch{return null}},
      fetch: async url => {requests++;return new Response(url.includes('large') ? 'x'.repeat(4_000_001) : 'image', {status: url.includes('missing') ? 404 : 200, headers:{'content-type':'image/png'}})},
      FileReader: class {readAsDataURL(blob) {blob.arrayBuffer().then(bytes=>{this.result='data:'+blob.type+';base64,'+Buffer.from(bytes).toString('base64');this.onload()})}}
    });
    const source=fs.readFileSync(path.join(__dirname,browser,'capture.js'),'utf8').replace(/^import .*\n/,'').replaceAll('export function','function');
    vm.runInContext(source+'\njob={};this.make=()=>assetsFor("https://en.wikipedia.org",()=>true,true);',context);
    let assets=context.make();
    const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10"/></svg>');
    for(let i=0;i<300;i++)assert.match(await assets.get(svg,'https://en.wikipedia.org'),/^data:image\/svg\+xml;base64,/);
    assert.equal(requests,0);assert.equal(permissionChecks,0);assert.equal(assets.skipped,0);
    const css=await context.rewriteCSS('.x{background:url("'+svg+'");filter:url(#local)}','https://en.wikipedia.org',assets);
    assert(css.includes('data:image/svg+xml;base64,'));assert(css.includes('url("#local")'));
    for(let i=0;i<189;i++)assert.match(await assets.get('https://thumb.wikimedia.org/'+i+'.png','https://en.wikipedia.org'),/^data:image\/png/);
    assert.equal(assets.skipped,0);assert.equal(requests,189);
    await assets.get('https://thumb.wikimedia.org/0.png','https://en.wikipedia.org');assert.equal(requests,189);
    granted=false;
    for(let i=0;i<5;i++)await assets.get('https://denied.example/image.png','https://en.wikipedia.org');
    assert.equal(assets.skipped,1);assert.equal(assets.reasons['site permission denied'],1);granted=true;
    for(let i=0;i<3;i++)await assets.get('https://thumb.wikimedia.org/missing.png','https://en.wikipedia.org');
    assert.equal(assets.reasons['HTTP 404'],1);assert.equal(requests,190);
    await assets.get('https://thumb.wikimedia.org/large.png','https://en.wikipedia.org');
    assert.equal(assets.reasons['file or archive size limit'],1);
    for(let i=189;i<254;i++)await assets.get('https://thumb.wikimedia.org/'+i+'.png','https://en.wikipedia.org');
    for(let i=0;i<4;i++)await assets.get('https://thumb.wikimedia.org/over-budget.png','https://en.wikipedia.org');
    assert.equal(assets.reasons['resource count limit'],1);
    console.log(browser+': PASS inline SVG with no requests, CSS fragments, 189 resources, deduplication, denied access, HTTP/size/count diagnostics');
  }
})().catch(error=>{console.error(error);process.exitCode=1});
