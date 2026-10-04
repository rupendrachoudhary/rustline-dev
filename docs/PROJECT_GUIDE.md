# rustline.dev — Project Guide

This guide explains what rustline.dev is, how every part works, why it was built the way it was, and what changed during review. The README is the reference manual; this document explains the reasoning behind it.

Version described: **0.2.1** (2026-10-04). Vulnerability data snapshot: **2026-09-22**.

---

## 1. What the product does, in one minute

rustline.dev answers one question for the page you are looking at: **"Which JavaScript libraries is this page running, and do any of those versions have known security problems?"**

There are two ways to use it:

| | Chrome extension | Batch scanner |
|---|---|---|
| Who uses it | Anyone, on one page at a time | A developer or security tester, on a list of pages |
| How it starts | Click the toolbar icon | `npm run scan` in a terminal |
| Output | A popup listing libraries and their status | `report.html` + `report.json` with a combined fix list |
| Self-hosted and bundled files | Optional: press **Check this site’s own script files** to read their licence banners | Read automatically from the scripts each page already downloaded |

Each detected library gets one of four statuses:

- **Vulnerable**: the version matches a published security advisory, for example jQuery 3.4.0 and CVE-2020-11022.
- **Outdated**: no advisory matched, but a newer stable version exists, or upstream says it is no longer maintained.
- **Current**: matches the newest stable version in the bundled data.
- **Unknown**: the library is present, but its exact version could not be determined or compared. It is never assumed safe.

What it does **not** do: no accounts, no backend server, no telemetry, no history. It never sends page data anywhere. Advisory data ships inside the extension. The only requests it ever makes to a website are for that site’s own script files, and only when you press the file-check button.

---

## 2. The big picture

```text
                ┌──────────────────────── Chrome extension (extension/) ────────────────────────┐
 user clicks →  │ popup/popup.js ──message──► background.js (service worker)                    │
   the icon     │      ▲                         │ 1. check focus + which tab                   │
                │      │                         │ 2. discover frames (cheap, no data)          │
                │      │                         │ 3. run two probes in up to 50 frames:        │
                │      │                         │      content/globals.js  (MAIN world)        │
                │      │                         │      content/scripts.js  (ISOLATED world)    │
                │      │                         │ 4. shared/detection.js  → merge evidence     │
                │      │                         │ 5. shared/vulnerabilities.js + data/*.json   │
                │      └──── report ◄────────────│    → Vulnerable/Outdated/Current/Unknown     │
                │ popup/render.js draws it       │ 6. headers.js: Server / X-Powered-By hints   │
                │                                │ 7. only on request: content/sources.js reads │
                │                                │    same-site script files, shared/banners.js │
                │                                │    matches their licence banners             │
                └───────────────────────────────────────────────────────────────────────────────┘

 tools/scan-sites.mjs (batch) ── Playwright drives the SAME extension in a throwaway Chrome ──►
      + shared/banners.js reads licence comments from scripts the page already downloaded
      → report.html / report.json

 scripts/refresh-data.mjs ── (developer only) downloads Retire.js + npm data → extension/data/vulnerabilities.json
 scripts/release.mjs      ── builds a reproducible, verified ZIP in dist/
```

The batch scanner **does not re-implement detection**. It opens the real popup through Chrome's debugging protocol, so it gets exactly the result a user would see, and adds banner evidence on top.

---

## 3. How a single scan works, step by step

This is what happens after you click the icon. The code is in `extension/background.js`.

1. **The popup opens and sends `{type: 'scan', windowId}`.** The popup includes its own window ID because Chrome can report the window as "not focused" while its popup is open (seen on macOS and Linux). Without the ID, scans failed with a false "Focus a Chrome window" error.
2. **Permission comes from your click.** The manifest requests no website permissions at all, so rustline.dev cannot touch any site until you click. Chrome's `activeTab` feature grants temporary access to the current tab at that moment. This is the core of the privacy promise.
3. **A scan ticket is created.** If you switch to another Chrome window while the scan is running, `windows.onFocusChanged` cancels the ticket and the scan stops with "You switched windows during inspection". This fixed a review finding (see §9). One special case: when Chrome reports "no window focused", the worker waits 300 ms and acts only if the popup has closed, because Linux sends that signal when the popup itself opens.
4. **Frame discovery.** A no-op script runs in every frame Chrome allows. It only learns which documents exist, not what is in them. The first 50 frames, including the top page, are selected. Cross-site frames are normally not accessible and are skipped by Chrome itself.
5. **Two probes run in the selected frames:**
   - `content/globals.js` runs in the page's own JavaScript world ("MAIN"), because that is the only place page variables like `window.jQuery` are visible. It reads version properties such as `jQuery.fn.jquery` or `Vue.version`. It skips getters, so it never deliberately runs page code, and it returns at most 100 results per frame.
   - `content/scripts.js` runs in an isolated world and lists `<script src>` URLs. It never downloads them, it strips query strings and fragments (which may contain tokens), and it reads at most 2,000 tags per frame.
6. **Safety re-checks.** Between steps the worker confirms the same tab, the same URL and the same document are still active. If the page reloaded or navigated mid-scan, the result is thrown away rather than mixed.
7. **Merge** (`shared/detection.js`). Globals and CDN URLs become rows. The same library and version from several sources become one row with several pieces of evidence. Different versions stay separate rows.
8. **Assess** (`shared/vulnerabilities.js`). Each row is compared with the bundled advisory ranges.
9. **Headers.** `Server` and `X-Powered-By` are shown only as hints. Headers are never retroactive, so the first scan usually offers "Reload page to read headers".
10. **Render** (`popup/render.js`). Everything is inserted as text, never as HTML, so a hostile page cannot inject markup into the popup. Any coverage limit that was reached shows a warning.

### The optional file check

Pressing **Check this site’s own script files** sends `{type: 'scan-files', windowId}`. The worker repeats steps 2 to 8 and adds one more between merging and assessing:

- `content/sources.js` runs in the isolated world of each selected frame, one frame at a time. It lists the frame’s `<script src>` tags, keeps only those on the frame’s own origin, and fetches them with `mode: 'same-origin'` and `cache: 'force-cache'`. A file the page already loaded normally comes from Chrome’s cache; other sites are never requested.
- The isolated world is used on purpose. A fetch from the page’s own world is subject to the page’s Content Security Policy, and a fetch from the service worker is refused; from the isolated world it works under the existing `activeTab` grant with no new permission.
- `shared/banners.js` parses each file with Acorn in the worker and matches licence banners (see §4). The file text is dropped straight after; only library, version, and the file’s host and path are kept.
- The result gains a `files` field with how many files were read and how many could not be inspected.

---

## 4. How libraries are detected

rustline.dev knows a curated set of **15 libraries** (`shared/libraries.js`): jQuery, AngularJS, React, React DOM, Vue, Lodash, Underscore, Moment, Bootstrap, Backbone, Handlebars, Axios, D3, Chart.js and DOMPurify.

There are three kinds of evidence:

| Evidence | Where | Example | Used by |
|---|---|---|---|
| **Global** | A version property on `window` | `window.jQuery.fn.jquery = "3.4.0"` | Extension and batch |
| **Script URL** | A versioned path on one of 4 known CDNs (exact hostname match) | `cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/…` | Extension and batch |
| **File banner** | The licence comment at the top of a library's file | `/*! jQuery v1.12.4 \| (c) jQuery Foundation */` | Extension (file check only) and batch |

Details worth knowing:

- **Lodash and Underscore both use `_`.** They are told apart by functions only one of them has.
- **jQuery custom builds** report versions like `3.5.1 -ajax,-effects`. The leading version is used and marked "(custom build)".
- **`@latest` and major-only CDN aliases** prove the library is present, never an exact version, so they show as Unknown.
- **Spoofing:** a page can fake a global or a URL. Detection is best effort, not proof.

### Banners: why they are opt-in in the extension

Most modern sites bundle libraries into files like `/assets/vendor.min.js`, where no global or CDN URL reveals them. The only surviving clue is often the licence comment each library ships with. Reading it requires the file's contents.

- **Batch scanner:** Playwright already holds the responses the page downloaded, so banners are read with **no extra requests**.
- **Extension:** the default scan never reads script contents, which keeps its privacy promise simple. Since 0.2.0 the popup offers the file check as a separate button, because without it most bundled sites showed an empty list that looked like a clean result. It is limited to the site's own origin and may re-request a file that is not in Chrome's cache.

Both use the same code, `extension/shared/banners.js` (`tools/banners.mjs` re-exports it). How it avoids false alarms:

- **It parses the file with Acorn instead of guessing with regular expressions.** Only real comments are inspected, never text inside strings, template literals or regex literals. For example, `const doc = "/*! jQuery v1.12.4 */"` is not a finding. The file is only parsed, never executed.
- **The library name must open the comment.** "Requires jQuery v1.7 or later", jQuery UI, jQuery Migrate and lodash's "Based on Underscore.js 1.8.3" are ignored.
- **Unparseable files are reported as incomplete coverage**, never as a partial "clean" result.
- **Only the top page and same-origin frames count.** Third-party ads and embeds stay out of your fix list.
- **Builds without a version banner are not guessed.** This includes lodash, React 18 and most minified Moment.

Checked against 30 real published builds: all 19 builds that ship a banner are recognised, none fail to parse, and a 3.3 MB concatenation of all of them takes about 250 ms.

---

## 5. How vulnerability status is decided

Data lives in `extension/data/vulnerabilities.json` (about 187 KB). It covers 15 libraries and 176 upstream advisories, derived from the open-source **Retire.js** database (Apache-2.0), plus the latest stable version of each library from npm.

- Each advisory has version **ranges**. `introduced` is inclusive and `fixed` is exclusive, so `≥ 1.2.0, < 3.5.0` includes 3.4.9 and excludes 3.5.0.
- `shared/versions.js` compares versions numerically, so `1.10 > 1.9`, and it follows SemVer prerelease rules. It also understands Retire's legacy forms, such as `1.9.0b1`.
- Precedence is **Vulnerable → Unknown (range can't be compared) → Outdated (end-of-life notice) → Outdated/Current (compared with the latest release)**.
- Each advisory gets a plain-English explanation. The original summary, CVE/GHSA identifiers and links are kept alongside it.
- `shared/database.js` validates the whole file on load: schema, dates, source hash, every version and every range. A corrupt file fails loudly instead of silently reporting "Current".
- The popup shows the snapshot date and warns once it is over 30 days old. The extension never updates itself over the network. To get new data, a developer runs `npm run refresh:data` and ships a new release.

---

## 6. Privacy and permission model

This is the part reviewers scrutinise most, and it is the product's main selling point.

| Promise | How it is enforced |
|---|---|
| Nothing runs until you click | No `host_permissions`, no static content scripts. Access comes only from Chrome's `activeTab` grant at click time. |
| Only the tab you clicked | The scan stops if focus moves to another window. The selection is dropped when the tab changes, closes or navigates to another site. |
| No data leaves the browser | The worker and popup make no network requests except reading the bundled data file (extension CSP: `connect-src 'self'`). The file check requests only the visited site's own script files, from that site, and sends nothing anywhere else. |
| No history | One ephemeral selection in `storage.session`, cleared on browser restart. The page URL is stored only as a SHA-256 hash, for header matching. |
| Minimal page interaction | Probes read values only. Getters are skipped. Script files are read only when you press the file-check button, and are parsed, never run. |
| Hostile page can't attack the popup | All rendering uses `textContent`, and header values are sanitised and length-capped. |

Permissions used: `activeTab`, `scripting` (to run the probes), `webRequest` (observe-only, for two headers) and `storage` (session only).

---

## 7. Coverage limits and "incomplete" warnings

An empty result must never be mistaken for a clean page. Every limit that stops inspection early is therefore reported.

| Limit | Value | Warning shown in |
|---|---|---|
| Script tags per frame | 2,000 | Popup, batch report |
| Frames inspected | 50 (including top page) | Popup, batch report |
| Combined across frames | 50 × 2,000 URLs, 50 × 100 globals, so merging never cuts anything | Popup, batch report (`unchecked`) |
| Script files read for banners (batch) | 300 per page, 8 MB each | Batch report |
| Script files read for banners (popup file check) | 100 per check, 4 MB each, 24 MB in total | Popup |
| Unparseable / unavailable script bodies | — | Popup (file check), batch report |

In the batch report, a page that hit any limit shows "⚠ Incomplete: …" in its row, a banner at the top counts such pages, and the terminal prints "incomplete coverage, see report".

Things that remain invisible by design:

- libraries inside cross-site frames
- closed-over ES modules and bundles without a banner
- script files on other origins, including custom CDN domains
- renamed or removed globals

---

## 8. The batch scanner in detail (`tools/scan-sites.mjs`)

1. It reads URLs from `tools/urls.txt` or the command line. Whole-line `#` comments and `URL  # note` suffixes are ignored, but **`#` inside a URL is kept**, so hash routes like `/#/admin` are distinct pages.
2. It launches a disposable headless Chromium with the **unmodified** extension loaded.
3. For each page:
   - it loads the page, waits for late scripts, and triggers the real popup through the CDP command `Extensions.triggerAction`;
   - it reloads once to capture headers, unless you pass `--no-headers`;
   - it collects the bodies of same-origin script responses and runs banner detection.
4. It pauses between pages (2 s by default, `--delay`) and makes no other requests.
5. It writes:
   - **`report.json`**, the raw data;
   - **`report.html`**, a self-contained page with summary tiles, a **Fix list** (each library version once, with every page that loads it) and a **Pages** table (libraries, frames, headers and coverage warnings). The report is HTML-escaped and supports dark mode.

⚠ **Only scan sites you are authorised to test.** The report describes weaknesses, so share it only with the site owner.

---

## 9. What changed during review (history of fixes)

| # | Finding | What was wrong, in plain words | Fix | Proof |
|---|---|---|---|---|
| 1 | Focus workaround weakened privacy | Passing the popup's window ID skipped the focus check for the whole scan. A scan kept running and returned results after you switched windows. | Each scan holds a ticket. A real focus change cancels it, and every mid-scan check rejects a cancelled ticket. | A browser test switches windows mid-scan. Old code: `ok: true`; new: cancelled. |
| 2 | Hash routes silently skipped | The URL list parser cut everything after `#`, so `/#/old` and `/#/new` became one scan of `/` with zero findings. | Only whole-line comments and notes after whitespace are removed. | Before: 1 page, 0 libraries. After: 2 pages, the correct version on each. |
| 3 | (Feature) bundled libraries invisible | Self-hosted bundles expose no globals or CDN URLs. | Licence-banner detection in the batch scanner. | Webpack-style page: 0 findings → 3 vulnerable. |
| 4 | Frame aggregation lost detections | Each frame allowed 2,000 tags, but merging stopped at 10,000 total without saying so. Six busy frames lost one library. | Combined limits = per-frame × frame limits, de-duplication, `unchecked` count, and warnings in popup and report. | 6 frames: old code found 5 of 6, new code finds 6 of 6. |
| 5 | Banner false positives (0.1.1) | Regex scanning matched banner-like text inside strings and regexes. | Real parsing with Acorn. Parse failures become "incomplete". | Batch test: quoted and regex examples produce 0 findings. |
| 6 | Frame budget applied too late (0.1.1) | Probes ran in every frame and the extras were discarded afterwards, so frames beyond 50 were still read. | Cheap discovery first, then probes only in the 50 selected documents. | Browser test with 55 frames: only 50 documents probed. |
| 7 | Release reproducibility (0.1.1) | No lockfile, no CI, and no way to tell whether a shared ZIP matched the source. | Pinned dev dependencies, CI workflow, deterministic ZIP with `BUILD.json` hashes and a `.sha256` file, and `release:test`. | Two builds are byte-identical, and all tests run from the extracted ZIP. |
| 8 | (Feature) bundled libraries invisible in the popup (0.2.0) | Banner detection existed only in the batch scanner, so the popup showed nothing for sites that bundle their libraries. | Opt-in file check: same-origin files only, fetched from the isolated world, parsed with a vendored Acorn. | Browser test under a strict CSP: default scan finds 0, file check finds jQuery 1.12.4; the other-origin script is never requested. |
| 9 | Headers lost on Linux (0.2.1) | Opening the popup on Linux makes Chrome report "no window focused". The worker treated that as leaving the page and wiped the selection, including headers captured by the reload. Found on the first CI run. | That signal is acted on 300 ms later, and only if the popup has closed. | The Linux release job failed on the header check before the fix and passes after it. |

---

## 10. Project layout

```text
extension/                  ← load this folder in Chrome
  manifest.json             MV3, version 0.2.1, 4 permissions, strict CSP
  background.js             focus/permission gates, tickets, frame discovery, scan, headers
  content/globals.js        MAIN-world probe (page variables), ≤100 results/frame
  content/scripts.js        ISOLATED-world probe (<script src> URLs), ≤2,000 tags/frame
  content/sources.js        ISOLATED-world, file check only: reads same-origin script files
  shared/libraries.js       the 15 libraries and where their versions live
  shared/detection.js       CDN URL parsing, evidence merging, aggregate limits
  shared/banners.js         licence-banner detection in parsed comments
  shared/versions.js        version parsing and comparison
  shared/vulnerabilities.js status decision
  shared/database.js        data-file validation
  shared/headers.js         Server/X-Powered-By allowlist and document matching
  vendor/acorn.mjs          Acorn 8.18.0 parser, unmodified, used by the file check
  data/vulnerabilities.json the bundled advisory snapshot
  popup/                    popup.html, popup.css, popup.js, render.js (text-only rendering)
  licenses/                 Retire.js licence + notice, Acorn licence, MIT
tools/
  scan-sites.mjs            batch scanner + HTML/JSON report
  banners.mjs               re-exports extension/shared/banners.js
  urls.txt                  page list for npm run scan
scripts/
  refresh-data.mjs          rebuild the advisory snapshot (developer, network)
  validate-data.mjs         validate the snapshot
  release.mjs               build / verify the reproducible ZIP
  test-release.mjs          full gate: build twice, extract, install, run all tests
tests/
  *.test.mjs                31 unit tests (node --test)
  browser.mjs               13 real-Chrome extension checks
  compat.mjs                5 checks for an older Chrome (set CHROME_PATH)
  batch-browser.mjs         4 end-to-end batch-scanner checks
demo/                       local demo site with 4 real library builds (npm run demo)
schema/                     JSON schema for the data file
.github/workflows/ci.yml    CI: unit tests on Linux/macOS/Windows + release gate on Linux
README.md · TESTING.md · VALIDATION.md · CHANGELOG.md · THIRD_PARTY_NOTICES.md · LICENSE
```

---

## 11. Everyday commands

```sh
npm ci --ignore-scripts          # install pinned dev tools (only needed for tests/batch/release)
npx playwright install chromium  # browser for browser/batch tests and scanning

npm run demo                     # local demo site at http://127.0.0.1:8787
npm run validate:data            # check the advisory snapshot
npm test                         # 31 unit tests
npm run test:browser             # 13 real-Chrome checks
CHROME_PATH=/path/to/chrome npm run test:compat   # 5 checks in an older Chrome, e.g. 120
npm run test:batch               # 4 batch-scanner checks
npm run scan                     # scan pages in tools/urls.txt → scan-reports/<time>/
npm run refresh:data             # update advisory data (then review diff, bump version)
npm run release                  # build dist/rustline-dev-<version>.zip + .sha256
npm run release:verify           # confirm the ZIP matches current source byte-for-byte
npm run release:test             # the final gate before sharing a build
```

Installing the extension itself needs no Node at all: go to `chrome://extensions`, turn on Developer mode, choose Load unpacked, and select the `extension/` folder.

---

## 12. Testing strategy

- **Unit tests** cover pure logic: all 15 library definitions, the 4 CDN patterns, spoofed URLs, version edge cases, range boundaries, data validation, headers, URL-list parsing, frame aggregation, banner patterns and false positives, and release verification.
- **Browser tests** load the real extension in a disposable Chrome and check behaviour that only a browser can prove:
  - no access before a click
  - real `activeTab` grants
  - popup rendering and header capture, including cookie exclusion and safe text rendering
  - focus cancellation and tab switching
  - cross-origin cleanup
  - six-frame aggregation, coverage warnings and the 55-frame budget
  - the file check under a strict page CSP, with other origins never requested
- **Batch tests** run the scanner end to end against local fixtures: hash routes, quoted false positives, a real banner with cross-origin exclusion, and unparseable files reported as incomplete.
- **Release test** runs all of the above from the extracted ZIP, so the thing you share is the thing that was tested.
- **Compatibility test** (`tests/compat.mjs`) runs the scan, header capture, file check and rendering in an older Chrome such as 120, the minimum version. Old Chrome cannot have its toolbar icon clicked by automation, so this test loads a temporary copy of the extension that is granted the local test host; the click-to-grant step itself is covered only by the main browser tests on current Chromium.

Each fix in §9 has a test that **fails on the old code**. That proves the test actually catches the bug.

---

## 13. Known limits and honest caveats

- Detection is best effort. Pages can hide or fake versions.
- A "Vulnerable" match means a known advisory applies to that version. It does not prove the vulnerable feature is reachable on that page.
- "Current" means current in the bundled snapshot, not guaranteed safe.
- Chrome and Manifest V3 only. Tested on macOS with Chromium 153 and Chrome 120. CI runs unit tests on Linux, macOS and Windows and the full release gate on Linux.
- The file check finds only files that kept their licence banner. A banner is text in a file, so it can be stale or faked.
- There is no automated test for leaving Chrome entirely during a scan; switching tabs and windows is tested.
- A same-origin iframe that navigates at the exact moment of a scan is skipped for that scan. Pressing ↻ rescans it.
- Not published to the Chrome Web Store. Distribution is by ZIP and "Load unpacked".

---

## 14. Glossary

- **MV3 (Manifest V3):** Chrome's current extension format. Background logic runs in a service worker that can be suspended at any time.
- **activeTab:** a temporary permission Chrome grants for the current tab when the user clicks the extension.
- **MAIN vs ISOLATED world:** the page's own JavaScript environment vs a private one for the extension. Page variables are only visible from MAIN.
- **Frame / iframe:** a page embedded in another page. Same-origin frames are readable, cross-site frames are not.
- **CDP:** Chrome DevTools Protocol, used by the batch scanner to control Chrome.
- **Retire.js:** an open-source database of vulnerable JavaScript library versions.
- **CSP (Content Security Policy):** rules a website sends to the browser about what code on its page may load or contact. It does not restrict the extension's isolated world.
- **Banner:** the licence comment at the top of a library file, which usually names the version.
- **Acorn:** a JavaScript parser. It reads code structure without running it.
- **Reproducible build:** building twice from the same source gives byte-identical output, so anyone can verify a ZIP.
