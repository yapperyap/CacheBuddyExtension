import {getPage, hasPage, webURL} from './db.js';
import {applyTheme} from './theme.js';

const query = new URLSearchParams(location.search);
const address = webURL(query.get('url'));
const archive = query.get('archive');
const frame = document.getElementById('copy');
const notice = document.getElementById('notice');
const original = document.getElementById('original');
const online = document.getElementById('online');
const label = document.getElementById('label');

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
    frame.addEventListener('load', function connect() {
      const copy = frame.contentDocument;
      if (copy?.URL !== 'about:srcdoc') return;
      frame.removeEventListener('load', connect);
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
    });
    frame.srcdoc = page.html;
    notice.hidden = true;
    frame.hidden = false;
  }
} catch (error) {
  notice.textContent = 'CacheBuddy could not open this copy. ' + error.message;
}
