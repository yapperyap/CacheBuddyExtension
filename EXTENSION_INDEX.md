# CacheBuddy extension index
Source: https://github.com/yapperyap/CacheBuddyExtension, Version 1.1.10 candidate.
Website index: WEBSITE_INDEX.md. Keep both indexes out of browser ZIPs and docs/.

| Feature | Source in chromium/ and firefox/ |
| --- | --- |
| Versions, permissions and entry points | manifest.json |
| Cache/Saved/Settings/Themes/About, media, script and ad options, crawl limits, theme, contact | popup.html, popup.js, ui.css |
| Staged user intent and host permissions, offline navigation | worker.js |
| HTML sanitization, resource embedding, comparison | capture.js, capture.html |
| IndexedDB and URL helpers | db.js (including staged uncapped crawls) |
| Cached page and dismissible banner | viewer.html, viewer.js, appearance.js, replay.html, replay.js, ui.css |
| Theme and local legal disclosure | theme.js, legal.html, legal.js |

## Important flows
- Chromium MV3/minimum 116: service worker → offscreen capture document. Firefox MV2/minimum 142: persistent capture page; browser API and beginCapture differ. Maintain both.
- popup saveMedia preference → staged worker intent → capture.js. On by default when no preference exists; explicit false is preserved. Media mode requests optional HTTP(S) host access; resume waits for all required permissions. Remove Ads defaults off. Change checks reuse the archive’s options (legacy defaults are media on, JavaScript off, ad removal off, and crawl caps on).
- Live-tab image currentSrc is copied into inert markup. Referenced external resources require browser permission; resource redirects omit credentials. Page crawling stays same-origin and respects robots/noarchive.
- Limits: 40 pages, 256 distinct downloaded resources, 4 MB/resource, 12 MB embedded content/page, 96 MB/archive. The uncapped option removes archive-wide caps for website mode while retaining per-file and per-page safeguards. Drafts publish atomically after the crawl. JavaScript capture defaults on for new saves; playback is user-initiated in an opaque sandbox (Chromium or Firefox 154+). CSS and permitted font/decorative assets are retained with media disabled.
- Static viewer uses sandboxed srcdoc and data-only media CSP. It reconnects known Wikipedia Appearance controls. Script playback uses a separate manifest sandbox with no extension APIs. Dismiss button hides header and switches grid to one row; no archive deletion.
- Privacy link: https://yapperyap.github.io/CacheBuddyExtension/privacy.html
- Contact text: Email: yapperyapemail@proton.me

## Checks and release
- Syntax: node --check on both browser folders' JS.
- Focused checks run: media on/off; external image/video embedding; denied permission; deduplication; snapshot sanitization; preference forwarding; banner dismissal. A live Wikimedia PNG fetched successfully. Full installed-browser integration is unverified.
- ZIP each browser directory with manifest.json at root; exclude indexes, website and test dependencies. Match ZIP bytes to source and SHA-256 to GitHub asset digest.
- User requests cloud browser for GitHub changes/uploads. No automatic marketplace submission. Firefox release ZIP is unsigned; marketplace version is independently managed.
- v1.1.3 published source and both asset digests matched local tested files. Newer release checks must be verified independently.

Chrome offscreen capture must use runtime messaging only: asset-permission messages go to worker.js (validates own capture.html sender, checks permissions there). Do not access chrome.permissions in capture.js. Regression tests must omit that API from offscreen mocks.

Regression command: node offscreen-permissions.test.cjs (standard Node libraries; no dependencies). Exercises runtime-only capture against the actual worker handler, denied/invalid senders, media off, and default preference behavior.

Snapshot order: img resources reserve budget before CSS decorations; inline SVG data URLs are normalized to base64 with file/page limits and no network permission request. Resource omissions are deduplicated and reported by cause. Empty/local CSS references are not counted. Regression: node resource-budget.test.cjs; live Ariane V88 markup and styles replayed with controlled network bodies (not installed-extension integration).

Snapshot control layout: retain native form control layout, safe SVG, and MathML. Clear sensitive input values, strip event handlers, and prevent form submission. Worker syncs checked and selected states into the inert clone. CSS URL parser handles escaped strings; inline SVG accepts ;utf8 as well as charset/base64 forms. Raw Wikipedia CSS regression is distinct from CSSOM-normalized replay.

Root-only development tests: npm ci && npm test (linkedom dev dependency for snapshot structural tests; no runtime dependency/build for extension or site). package-lock.json pins the test toolchain. Exclude node_modules and all root test files from browser ZIPs.
