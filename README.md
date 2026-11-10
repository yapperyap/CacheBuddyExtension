# CacheBuddy

CacheBuddy saves static copies of web pages and linked public pages for offline reading. Capture is manual, and snapshots stay in your browser profile.

Website link: https://yapperyap.github.io/CacheBuddyExtension/


| Browser | Source folder | Install the matching release ZIP |
| --- | --- | --- |
| Chromium 116+ (Chrome, Edge, Brave) | [chromium/](chromium/) | Extract the Chromium ZIP, open your browser's extensions page, turn on Developer mode, and select **Load unpacked**. Choose the folder containing `manifest.json`. |
| Firefox 142+ and compatible Firefox-based browsers | [firefox/](firefox/) | Extract the Firefox ZIP, open `about:debugging#/runtime/this-firefox`, select **Load Temporary Add-on**, and choose the extracted `manifest.json`. |

Standard Firefox removes temporary add-ons on restart. Permanent installation requires a Mozilla-signed build.

Choose **Cache page** or **Cache website** in the popup and approve site access. Website mode follows linked public pages on the same origin, up to 40 by default. **Cache → Disable website crawl caps** removes the page, resource-count, and archive-size caps. Per-file and per-page safeguards still apply. Reopen a saved address offline or open it from **Saved**. Offline copies open in the extension viewer, which displays the original URL. **Save images and other media** is on by default. **Remove ads** is off by default and omits recognized ad placements when enabled. Choose System, Paper, Ink, Moss, or Clay under **Settings → Color theme**. **Save page JavaScript** is on by default. The viewer opens a static copy and offers **Run saved scripts** for isolated playback on supported browsers (Chromium or Firefox 154+). Live-server features and unavailable script dependencies may fail. Wikipedia Appearance controls work in the static viewer.

The extension source is MIT-licensed. The bundled IBM Plex Sans font is covered by the SIL Open Font License included in each browser folder.
