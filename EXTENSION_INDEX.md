# CacheBuddy extension index
Source: https://github.com/yapperyap/CacheBuddyExtension, main. Version 1.1.4, verified 2026-11-06.
Website index: WEBSITE_INDEX.md. Keep both indexes out of browser ZIPs and docs/.

| Feature | Source in chromium/ and firefox/ |
| --- | --- |
| Versions, permissions and entry points | manifest.json |
| Cache/Saved/About, media toggle, theme, contact | popup.html, popup.js, ui.css |
| Staged user intent and host permissions, offline navigation | worker.js |
| HTML sanitization, resource embedding, comparison | capture.js, capture.html |
| IndexedDB and URL helpers | db.js |
| Cached page and dismissible banner | viewer.html, viewer.js, ui.css |
| Theme and local legal disclosure | theme.js, legal.html, legal.js |

## Important flows
- Chromium MV3/minimum 116: service worker → offscreen capture document. Firefox MV2/minimum 142: persistent capture page; browser API and beginCapture differ. Maintain both.
- popup saveMedia preference → staged worker intent → capture.js. Off by default. Media mode requests optional HTTP(S) host access; resume waits for all required permissions. Change checks use the archive's saved option (legacy archives default true).
- Live-tab image currentSrc is copied into inert markup. Referenced external resources require browser permission; resource redirects omit credentials. Page crawling stays same-origin and respects robots/noarchive.
- Limits: 40 pages, 90 distinct resources, 4 MB/resource, 12 MB embedded content/page, 96 MB/archive. Static snapshots; streaming/auth-required resources may fail. CSS retained with media disabled; binary resources omitted.
- Viewer uses sandboxed srcdoc and data-only media CSP. Dismiss button hides header and switches grid to one row; no archive deletion.
- Privacy link: https://yapperyap.github.io/CacheBuddyExtension/privacy.html
- Contact text: Email: yapperyapemail@proton.me

## Checks and release
- Syntax: node --check on both browser folders' JS.
- Focused checks run: media on/off; external image/video embedding; denied permission; deduplication; snapshot sanitization; preference forwarding; banner dismissal. A live Wikimedia PNG fetched successfully. Full installed-browser integration is unverified.
- ZIP each browser directory with manifest.json at root; exclude indexes, website and test dependencies. Match ZIP bytes to source and SHA-256 to GitHub asset digest.
- User requests cloud browser for GitHub changes/uploads. No automatic marketplace submission. Firefox release ZIP is unsigned; marketplace version is independently managed.
- v1.1.3 published source and both asset digests matched local tested files. Newer release checks must be verified independently.
