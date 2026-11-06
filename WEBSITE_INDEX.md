# CacheBuddy GitHub Pages index
Source: https://github.com/yapperyap/CacheBuddyExtension, main/docs. Inspected 2026-11-06.
Live site: https://yapperyap.github.io/CacheBuddyExtension/
Extension index: EXTENSION_INDEX.md. This file stays outside served docs/ and browser ZIPs.

| Feature | Path |
| --- | --- |
| Landing page, installation, media limits, download buttons | docs/index.html |
| Shared styling, screenshot crop, 680px mobile breakpoint | docs/site.css |
| Privacy, external resource requests, optional permissions | docs/privacy.html |
| Terms, support, licensing | docs/terms.html |
| Screenshot, icon, local font and license | docs/demo.png, docs/icon.png, docs/plex.woff2, docs/OFL.txt |

## Contracts
- Buildless HTML/CSS, docs/.nojekyll; no package manager or build needed. Preview: python -m http.server 8000 --directory docs
- Buttons: GitHub Releases; Chrome Extension → https://chromewebstore.google.com/detail/cachebuddy/jghepnookbdhkaaibheeldmhaoknpmch ; Firefox Extension → https://addons.mozilla.org/en-US/firefox/addon/cachebuddy/
- Contact label exactly Email: yapperyapemail@proton.me; keep mailto action, privacy/terms and donation links.
- Screenshot is not a link. .demo-image crops baked-in blank bottom with aspect-ratio 1280/657, overflow hidden; retain UI-change caption.
- Preserve established colors, responsive wrapping, focus styles and privacy claims. No analytics or server needed.

## Verification and publishing
- Live page verified: correct store/download URLs and literal email; screenshot loads, click stays on page, crop ratio matches, no desktop horizontal overflow.
- Check live privacy/terms links, media instructions, and Pages job after changes. Mobile viewport rendering and installed extension are separate checks; do not infer from desktop source tests.
- GitHub Pages uses docs/ on main. Browser-uploaded commits trigger pages-build-deployment. Deployment may queue; verify live content before claiming completion.
- User prefers cloud browser for GitHub. Extension release upload and store submission are separate operations.
