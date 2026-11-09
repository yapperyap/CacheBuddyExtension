// This page is sandboxed by the manifest and the parent iframe. It has no extension APIs.
addEventListener('message', async function loadArchive(event) {
  if (event.source !== parent || event.origin !== location.origin || event.data?.type !== 'cachebuddy-replay') return;
  if (self.origin !== 'null') return;
  removeEventListener('message', loadArchive);
  const {html, scripts} = event.data;
  const copy = new DOMParser().parseFromString(html, 'text/html');
  for (const name of ['lang', 'dir', 'class', 'id', 'style']) {
    const value = copy.documentElement.getAttribute(name);
    if (value !== null) document.documentElement.setAttribute(name, value);
  }
  document.head.append(...copy.head.querySelectorAll('style,meta[name="viewport"]'));
  document.body.replaceWith(copy.body);
  // Keep section links inside this view. The static viewer handles links to other pages.
  for (const link of document.body.querySelectorAll('a[href]')) {
    if (!link.getAttribute('href').startsWith('#')) link.removeAttribute('href');
    link.removeAttribute('target');
  }

  const modules = [];
  for (const saved of scripts) {
    const script = document.createElement('script');
    if (saved.type) script.type = saved.type;
    if (saved.type === 'module') {
      modules.push(new Promise(resolve => {
        script.addEventListener('load', resolve, {once: true});
        script.addEventListener('error', resolve, {once: true});
      }));
    }
    script.textContent = saved.text;
    document.body.append(script);
  }
  await Promise.all(modules);
  document.dispatchEvent(new Event('DOMContentLoaded', {bubbles: true}));
  window.dispatchEvent(new Event('load'));
});

if (self.origin === 'null' && location.hash) {
  parent.postMessage({type: 'cachebuddy-replay-ready', token: location.hash.slice(1)}, location.origin);
}
