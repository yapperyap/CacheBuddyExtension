CacheBuddy 1.1.12
Made by Yap

INSTALL
1. Extract CacheBuddy-chromium-1.1.12.zip to a folder you can keep.
2. In Chrome 116 or later, open chrome://extensions and enable Developer mode.
3. Choose Load unpacked and select the extracted folder containing manifest.json.
4. Open CacheBuddy from Chrome's Extensions menu. Pin it if you want one-click access.

SAVE AND REOPEN
Open an HTTP or HTTPS page. Choose This page or This website and press Cache.
Approve site access if prompted. The popup shows progress and any skipped items.
Capture starts after approval, even if Chrome closes the popup. Reopen it to
see progress. The Cache view shows page and website status and lets you uncache
the selected saved copy.
Remove ads is optional and off by default. Set a color theme in Settings.
You can close the popup once capture starts. Use Saved to open or delete copies.

To reopen a saved page offline, enter its original address. After Chrome reports
a supported network failure, CacheBuddy opens the local copy in a viewer tab
addressed with a chrome-extension:// URL. The header displays the original URL.
You can also open a copy directly from Saved, including while you're online.

CHECK AND UPDATE
Select the same scope, then press Check for changes while online. A check compares
the available snapshots and resources without modifying the archive. Use Update
to replace the archive. The existing archive is kept if the root or a previously
saved page or resource fails during refresh. There is no background caching or
change monitoring.

SCOPE
This page captures the rendered DOM when Chrome allows it, or falls back to a
public HTML fetch. Refresh the live page before checking a rendered snapshot.
This website follows linked public HTML pages on the same origin, starting at
the current page and origin homepage. It checks robots.txt and applicable
noarchive directives on fetched pages, and uses no login credentials. The site
default limit is 40 pages and 96 MB per capture. In Cache, Disable website
crawl caps removes those limits and the resource-count limit. Per-file and
per-page safeguards still apply. Stop cancels a capture before it replaces
the saved archive.

The viewer opens a static snapshot. Save page JavaScript defaults to on.
Run saved scripts uses a separate sandbox when supported by the browser.
Scripts that rely on live servers, cookies, or unavailable module imports may
not work. Wikipedia Appearance controls work in the static copy. Styles, fonts, common media, and inline
vector graphics can be preserved within browser permissions and size limits.
Site scripts, form submissions, embedded frames, and protected resources may
be unavailable. For private rendered pages, save only if you are
comfortable keeping the visible content in the current browser profile.

PRIVACY AND TERMS
Open About > Privacy, terms & permissions for the complete notice, including
permission purposes, contact and font attribution. If distributing this in the
Chrome Web Store, host the current privacy notice publicly, link it in the
listing, and complete the store's Privacy practices disclosures before submission.

Contact: yapperyapemail@proton.me
Donate: https://ko-fi.com/yapperyap
GitHub: https://github.com/yapperyap
