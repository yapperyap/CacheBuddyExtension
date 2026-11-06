# CacheBuddy project index
Source: https://github.com/yapperyap/CacheBuddyExtension (main). Inspected 2026-11-06.
Website: https://yapperyap.github.io/CacheBuddyExtension/

| Feature | Paths |
| --- | --- |
| Website, marketplace buttons, install guide | docs/index.html |
| Responsive site styles and screenshot crop | docs/site.css |
| Public policies and email contact | docs/privacy.html, docs/terms.html |
| Browser permissions and version | chromium/manifest.json, firefox/manifest.json |
| Popup, privacy link, email contact | Each browser folder: popup.html, popup.js, ui.css |
| Local legal details and email | Each browser folder: legal.html |
| Capture and background navigation | Each browser folder: capture.js, capture.html, worker.js |
| Local archives and viewer | Each browser folder: db.js, viewer.html, viewer.js |

Version: 1.1.1. Chromium MV3; Firefox MV2. Maintain both implementations.
Privacy link: https://yapperyap.github.io/CacheBuddyExtension/privacy.html
Contact text: Email: yapperyapemail@proton.me
Buildless website in docs/. Preview: python -m http.server 8000 --directory docs
No automated suite/build config observed. Check links, wrapping, and screenshot crop.
Release ZIPs contain the corresponding browser folder contents with manifest.json at archive root. Verify ZIP/source equality and matching versions before upload.
Keep this index outside docs/ and browser ZIPs. Pages and releases require remote verification after publication.
