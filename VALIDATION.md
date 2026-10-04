# Validation record

Validated on 2026-09-22 using Node 26.7.0 and Chrome 153.0.8010.53 on macOS, with a disposable browser profile and the unmodified extension manifest.

- 17 Node tests pass (`npm test`).
- The bundled snapshot passes `npm run validate:data`: 15 libraries, 176 upstream advisories, 187 KB of JSON (approximately).
- The refresh script successfully fetched public npm release metadata and processed the downloaded Retire.js source. Offline reprocessing with the same source/release snapshot also succeeds. A malformed import leaves the old output untouched; offline inputs require their original snapshot date.
- Eight integration checks pass (`npm run test:browser`): no host grants or scans before invocation; actual activeTab access and both probe worlds; real popup rendering; explicit reload/header capture with cookie exclusion and safe text rendering; popup layout; tab-switch isolation; empty-page handling without stale results; and cross-origin cleanup after activeTab revocation.
- Visually inspected the actual popup screenshot from the local test fixture. All four status badges are represented and no horizontal overflow was found.

The test fixture uses representative exposed globals and a CSP-blocked CDN script reference, not downloaded vulnerable libraries. This verifies detection mechanics and advisory matching without executing vulnerable third-party code. A script reference does not prove execution, as documented in the UI guide.

Limits: not tested across every Chrome release or arbitrary live websites. Header capture is best effort around cached responses, service workers, and worker-restoration races; missing data remains unavailable. Closed-over bundles and libraries only in cross-origin frames are outside the detector’s reach. No Chrome Web Store publication or installation into the normal user profile was performed.

## Portable team testing kit — 2026-09-23

Added TESTING.md and a Node-only local demo with four real, licensed library builds. The extension runtime is unchanged. Re-ran the 17 unit tests and bundled-data validation successfully. A temporary headless Chrome smoke check verified all four global/version results, the empty page, both demo response headers, missing-file 404 behavior, and zero external page requests.

## Frame scanning — 2026-09-25

The scan now covers every frame the activeTab grant reaches (framesets and same-origin iframes), not only the top frame. It was prompted by a frameset site where all libraries live in child frames. The popup also passes its own window ID, fixing a false “Focus a Chrome window” error seen on macOS. 17 Node tests and 8 real-Chrome checks pass (Chrome, macOS); the browser fixture now expects the same-origin iframe’s Backbone 0.4.0 to be reported with frame evidence.

## Custom builds and batch scanning — 2026-09-25

jQuery custom/slim builds report versions like `3.5.1 -ajax,-effects`; the leading version is now used and the evidence is marked “(custom build)”. Unrecognised version text is shown verbatim in the evidence instead of being dropped. New `tools/scan-sites.mjs` (`npm run scan`) batch-scans a URL list with the real extension and writes an HTML/JSON report. 18 Node tests pass; the batch scanner was verified against the local demo (all four statuses, both headers, a failing page recorded as an error) and its report was checked at desktop and phone widths with no horizontal overflow.

## Mid-scan focus cancellation — 2026-09-25

Because the popup passes its window ID, the focus check was skipped for the whole scan, so a scan kept running and returned results after the user switched windows. Each scan and reload now holds a ticket that `windows.onFocusChanged` cancels when focus leaves the scanned window, and the mid-scan checks reject a cancelled ticket. A new real-Chrome check keeps the page busy, switches windows mid-scan, and expects a cancellation; it fails on the previous code (`ok: true`) and passes now. 18 Node tests and 9 real-Chrome checks pass (Chromium headless shell 154, macOS).

## Batch scanner keeps hash routes — 2026-09-25

The URL list parser stripped everything after any `#`, so `/#/old` and `/#/new` collapsed into one scan of `/` with zero findings and no error. Only whole-line comments (and notes after whitespace) are now ignored; fragments are kept. Reproduced against a local hash-routed page: before, 1 page and 0 libraries; after, 2 pages, jQuery 1.12.4 vulnerable on `/#/old` and 3.7.1 on `/#/new`. 20 Node tests pass, including 2 new URL-list tests.

## Library banners in the batch scanner — 2026-09-25

The batch scanner now reads library licence banners from script responses the page already received (top page and same-origin frames only; no extra requests), covering self-hosted and bundled files the extension cannot see. The extension is unchanged. Patterns were checked against 30 real published builds of the 15 libraries: every build that ships a version banner is recognised; jQuery UI, jQuery Migrate, lodash's "Based on Underscore.js 1.8.3" line and banner-less builds produce nothing. A 3.3 MB bundle of all 30 files gives all 19 banners in about 12 ms. End to end, a local page loading jQuery 1.12.4, Handlebars 4.7.7 and Underscore 1.8.3 wrapped webpack-style (no globals) in `/assets/vendor.min.js?v=42` went from 0 findings from the extension alone to 3 vulnerable rows with banner evidence; a cross-origin iframe's Chart.js was correctly excluded. 24 Node tests pass.

## Frame aggregation coverage — 2026-09-25

Each frame allows 2,000 script tags, but merging cut the combined list at 10,000 URLs (and globals at 1,000) without a flag, so six frames of 2,000 tags lost a library while reporting `truncated: false`. The combined bounds are now the per-frame caps times the 50-frame cap (100,000 URLs, 5,000 globals), repeated URLs are counted once, and any overflow is returned as `unchecked` and shown. The batch report previously showed no coverage warnings at all; it now lists every reached limit per page, in a banner above the fix list and in the terminal, including script files skipped for banner reading. A new real-Chrome check (six same-origin frames, 2,000 distinct tags each, one library per frame) finds all six; with the old 10,000 bound restored it finds five, reproducing the report. A batch run on a frame with 2,500 tags shows the “Incomplete” warning. 26 Node tests and 11 real-Chrome checks pass.

## 0.1.1 release validation — 2026-09-26

- 31 unit tests pass, including quoted/template/regex banner regressions, unsupported syntax, and rejection of stale/missing/extra ZIP content.
- Bundled data validation passes; the advisory snapshot remains 2026-09-22.
- 12 Chrome integration checks pass. The additional frame-budget fixture has 55 child frames and confirms only 49 children plus the top document receive the library probes. Discovery itself is a lightweight no-data call across accessible frames.
- Four end-to-end batch checks pass across five local pages: distinct hash routes, zero findings from quoted examples, actual banner findings with cross-origin/query exclusion, and incomplete-coverage reporting for unparseable JavaScript.
- The parser also accepts all four real demo builds; jQuery, Vue and Axios banners are identified, while the bannerless Moment build is not guessed.
- Development tools are pinned: Acorn 8.18.0, fflate 0.8.3, Playwright 1.63.0, and its matching playwright-core. Initial checks used Node 26.7.0 and system Chrome 154 on macOS with disposable profiles.
- `npm run release:test` is the final distribution gate: two identical builds, byte-for-byte archive/source verification, a clean extraction and locked install, then all data/unit/browser/batch checks run from that extracted copy. Its terminal result and BUILD.json source hash identify the verified artifact.
- GitHub Actions configuration includes Linux/macOS/Windows unit checks and a Linux extracted-release browser job. Hosted CI has not been executed in this local workspace; the project must be placed at the repository root and pushed for those jobs to run.

## Opt-in file check in the extension — 2026-10-04

The popup gains **Check this site’s own script files**, which reads same-origin script files from the `ISOLATED`-world probe and applies the batch scanner's banner matching. Checked in Chromium 153 with the real extension against a page served with `default-src 'none'; script-src 'self'; connect-src 'none'`: the same-origin file is read after the activeTab click, while a `MAIN`-world fetch, a service-worker fetch and any cross-origin file all fail, and nothing can be injected before the click. A new real-Chrome check loads a page whose only library is a jQuery 1.12.4 banner inside a closure: the default scan reports nothing, the file check reports it as vulnerable with banner evidence, an unparseable file is counted as not inspected, the query token is not retained and the other-origin script is never requested. 31 Node tests, 13 real-Chrome checks and 4 batch checks pass. Not checked at the time: Chrome 120 (see below) and pages with a CSP `sandbox` directive.

## Linux focus fix and Chrome 120 — 2026-10-04

The first hosted CI run failed the Linux release job: headers captured by the reload were gone when the popup reopened. The run's diagnostic events showed `windows.onFocusChanged` firing with `WINDOW_ID_NONE` as the popup opened, followed by the selection being cleared. The worker now acts on that signal 300 ms later and only if no popup is open. After the fix, unit jobs pass on Linux, macOS and Windows and the release job passes on Linux.

`npm run test:compat` was run against Chrome for Testing 120.0.6099.109 on macOS arm64: worker start-up, globals, CDN URLs, a same-origin frame, header capture, the file check under a strict CSP and popup rendering all pass (5 checks). That build cannot have its toolbar icon clicked by automation, so the check uses a temporary copy of the extension granted `http://127.0.0.1/*`; the activeTab grant itself was not exercised on Chrome 120.
