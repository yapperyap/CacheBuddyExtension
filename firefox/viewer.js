import {getPage, hasPage, webURL} from './db.js';
import {connectAppearance} from './appearance.js';
import {applyTheme} from './theme.js';

const query = new URLSearchParams(location.search);
const address = webURL(query.get('url'));
const archive = query.get('archive');
const frame = document.getElementById('copy');
const notice = document.getElementById('notice');
const original = document.getElementById('original');
const online = document.getElementById('online');
const label = document.getElementById('label');

document.getElementById('dismissBanner').addEventListener('click', () => {
  document.getElementById('cacheBanner').hidden = true;
  document.body.classList.add('banner-dismissed');
  frame.focus();
});

await applyTheme();
if (address) {
  original.hidden = online.hidden = false;
  original.textContent = address.href;
  original.href = address.href;
  online.onclick = () => location.assign(address.href);
}

try {
  const page = address && await getPage(address.href, archive);
  if (!page) {
    notice.textContent = 'This address has no saved copy. Use the original address to try it online.';
  } else {
    document.title = page.title + ' · Offline copy';
    label.textContent = 'Offline copy · ' + new Date(page.savedAt).toLocaleDateString();
    const replay = document.getElementById('replay');
    const sandboxSupported = Number.parseInt((await browser.runtime.getBrowserInfo()).version, 10) >= 154;
    let playing = false, replayToken = null;
    replay.hidden = !page.scripts?.length || !sandboxSupported;
    replay.addEventListener('click', () => {
      playing = !playing;
      replay.textContent = playing ? 'Return to saved page' : 'Run saved scripts';
      if (playing) {
        replayToken = crypto.randomUUID();
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.src = 'replay.html#' + replayToken;
        frame.removeAttribute('srcdoc');
      } else {
        showSnapshot();
      }
    });
    addEventListener('message', event => {
      if (!playing || !replayToken || event.source !== frame.contentWindow || event.origin !== 'null' ||
          event.data?.type !== 'cachebuddy-replay-ready' || event.data.token !== replayToken) return;
      replayToken = null;
      frame.contentWindow.postMessage({type: 'cachebuddy-replay', html: page.html, scripts: page.scripts}, '*');
    });
    frame.addEventListener('load', () => {
      if (!playing) connect();
    });
    function connect() {
      const copy = frame.contentDocument;
      if (copy?.URL !== 'about:srcdoc') return;
      connectAppearance(copy, address.hostname);
      function scrollToFragment(fragment) {
        try {
          const name = decodeURIComponent(fragment.slice(1));
          const anchor = copy.getElementById(name);
          if (anchor) anchor.scrollIntoView();
          else if (!name) frame.contentWindow.scrollTo(0, 0);
        } catch {
          // A malformed fragment should still open the page.
        }
      }
      if (address.hash) scrollToFragment(address.hash);
      copy.addEventListener('click', async event => {
        if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        const ref = event.target.closest?.('a[href]')?.getAttribute('href');
        if (!ref) return;
        if (ref.startsWith('#')) {
          event.preventDefault();
          scrollToFragment(ref);
          return;
        }
        const target = webURL(ref);
        if (!target) return;
        event.preventDefault();
        try {
          const matching = await getPage(target.href, page.archive);
          if (matching || await hasPage(target.href)) {
            const next = new URLSearchParams({url: target.href});
            if (matching) next.set('archive', page.archive);
            location.assign('viewer.html?' + next);
            return;
          }
        } catch {
          // Fall back to the original URL if the local index cannot be read.
        }
        location.assign(target.href);
      });
    }
    function showSnapshot() {
      frame.setAttribute('sandbox', 'allow-same-origin allow-top-navigation-by-user-activation');
      frame.srcdoc = page.html;
      frame.removeAttribute('src');
    }
    showSnapshot();
    notice.hidden = true;
    frame.hidden = false;
  }
} catch (error) {
  notice.textContent = 'CacheBuddy could not open this copy. ' + error.message;
}
