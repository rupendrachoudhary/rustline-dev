# rustline.dev

A small Chrome Manifest V3 extension that identifies exposed JavaScript libraries and flags versions matching a bundled Retire.js advisory snapshot. Vanilla JavaScript, no build step, no npm installs, no backend, no accounts, no telemetry.

## What it does

Click the extension on any web page and it tells you:

- which of 15 common JavaScript libraries (jQuery, React, Vue, Lodash, Bootstrap and others) the page is using, and which version;
- whether that version has a known security advisory, is simply out of date, or is current;
- what the advisory means in plain English, with a link to the original report.

Everything runs inside your browser. Nothing is sent to a server, and the extension can only look at a page after you click it there.

## Install

You need desktop Google Chrome 120 or later. There is nothing to build or install from npm.

1. Download this repository (**Code → Download ZIP**, then extract it) or clone it:

   ```sh
   git clone https://github.com/rupendrachoudhary/rustline-dev.git
   ```

2. Open `chrome://extensions` in Chrome and turn on **Developer mode** (top-right corner).
3. Click **Load unpacked** and choose the **`extension`** folder inside the project. Pick the folder that contains `manifest.json`, not its parent.
4. Open Chrome’s puzzle-piece menu and pin **rustline.dev** to the toolbar.

To update later, replace the files (or `git pull`), then click the reload icon on the rustline.dev card in `chrome://extensions`.

## Use it

1. Open the website you want to check. It must be a regular `http://` or `https://` page.
2. Click the **rustline.dev** icon. The popup scans the page straight away and lists each library it found.
3. Read the badge on each library:

   | Badge | What it means | What to do |
   |---|---|---|
   | **Vulnerable** | This version matches at least one known security advisory. | Open the row to read the advisory, then plan an upgrade. |
   | **Outdated** | No advisory matched, but a newer stable release exists (or the version is end-of-life). | Upgrade when convenient. |
   | **Current** | Matches the latest release in the bundled data, with no advisory. | Nothing. This is not a guarantee that the library is safe. |
   | **Unknown** | The library was found but its version could not be read or compared. | Check the version yourself. |

4. Click a row’s **detection evidence** line to see how the library was found, the affected version range and a link to the upstream advisory.

The popup also has three optional actions:

| Action | When to use it | What it does |
|---|---|---|
| **↻** (top right) | The page loaded more scripts after you opened the popup, for example after you clicked something on the page. | Scans the page again. |
| **Check this site’s own script files** | The scan found little or nothing, and you suspect the site bundles its libraries into its own files. | Reads the script files hosted on the same site and looks for each library’s name-and-version comment. Files on other sites are never requested. |
| **Reload page to read headers** | You want to see the `Server` and `X-Powered-By` response headers. | Reloads the page like Chrome’s reload button (unsaved form input is lost), then shows the two headers when you open the popup again. |

### Try it on the built-in demo

If you have [Node.js 22+](https://nodejs.org/en/download), you can see every badge on a local test page:

```sh
npm run demo
```

Open `http://127.0.0.1:8787/` and click the rustline.dev icon. [TESTING.md](TESTING.md) lists the results to expect.

### What it can and cannot tell you

- **A match is a lead, not proof.** “Vulnerable” means the version number falls in an advisory’s range. It does not show that the weak feature is used or reachable on that page.
- **An empty list is not a clean bill of health.** Libraries packed into a bundle with their comments stripped, loaded from an unrecognised CDN, or running only inside a frame from another site cannot be seen.
- **Only 15 libraries are checked.** They are listed under [Detection coverage](#detection-coverage).
- **The advisory data is a snapshot.** Its date is shown at the bottom of the popup, with a warning once it is more than 30 days old. See [Refresh data independently](#refresh-data-independently).
- **Restricted pages cannot be scanned.** That includes `chrome://` pages, the Chrome Web Store and local files.

### If something goes wrong

| You see | Likely cause | Fix |
|---|---|---|
| “Open rustline.dev from a regular HTTP or HTTPS page” | The active tab is a Chrome page, the Web Store, a file or another extension. | Switch to a normal website and click the icon again. |
| “Chrome could not inspect this page” | Access lapsed, usually because the tab moved to a different site. | Close the popup and click the icon again. |
| “You switched windows during inspection” | Another window took focus while the scan was running. | Keep the page focused and click the icon again. |
| Headers show as unavailable | The page loaded before you clicked the extension. | Use **Reload page to read headers**. |
| “The extension did not respond” | Chrome stopped the extension after an update or error. | Click the reload icon on its card in `chrome://extensions`. |

The rest of this document is reference material for developers and reviewers.

## Permission choice: activeTab, with an explicit click

The proposed `activeTab` approach fits this tool better than automatic access to every site. The important constraint is that **focusing a tab or receiving `tabs.onUpdated` does not grant `activeTab`**. A user must invoke the extension. The grant persists for same-origin navigation and is revoked by cross-origin navigation or closing the tab.

Accordingly, rustline.dev:

- Scans the focused tab when the popup opens or the user presses scan again: the top page plus every frame (frameset or iframe) the activeTab grant covers, up to 50. Cross-origin frames are normally not covered and are skipped. Findings from a frame name that frame’s path (never its query string).
- Does not install static content scripts, scan tabs on activation, or inject from `tabs.onUpdated`.
- Uses `tabs.onUpdated` only to invalidate stale header state or discard a selection after an origin change.
- Reads page globals through a short, packaged `MAIN`-world probe. Ordinary content scripts use an isolated world and cannot read page JavaScript globals directly.
- Reads script URLs in an `ISOLATED`-world probe; strips query strings and fragments. The default scan does not download scripts.
- Reads this site’s own script files only when you press **Check this site’s own script files** (see [Self-hosted files](#self-hosted-files-opt-in)).
- Registers its header observer after a click has granted access; Chrome rejects `webRequest` registration before an effective host grant exists. The API listener is scoped to the selected tab and hostname. The worker further checks origin and that the selection is still live (a focus change drops it) before selecting `Server` and `X-Powered-By` from a main-document response. URL patterns are **filters, not host permission grants**.
- Drops its selection when the selected tab/window loses focus or the tab closes. A scan or reload already in progress is cancelled if focus moves to another window (or away from Chrome) and returns no results. Chrome on Linux also reports “no window focused” when the popup itself opens, so that signal is acted on a moment later and only if the popup has closed. Chrome may retain a same-origin `activeTab` grant longer, but rustline.dev does not use it to scan other tabs.
- Keeps one selection and its two header values in `chrome.storage.session`, not in persistent storage. No browsing history or scan results are saved. A document URL is hashed for header correlation, not stored verbatim. Session data is cleared when Chrome restarts.

There are **no `host_permissions`, `<all_urls>`, `tabs`, `webNavigation`, or `webRequestBlocking` permissions**. `storage` supports ephemeral header state across MV3 worker suspension. `scripting` runs the two probes. `webRequest` observes response headers; it never modifies or blocks traffic.

Headers are not retroactive and are not available from the DOM. A first scan will usually show a reload prompt. The reload command wakes the worker and registers the observer before reloading. Cached responses, service workers, redirects, tab/window focus changes, a response racing worker restoration, or Chrome restrictions can leave headers unavailable; that remains explicitly unknown. No HEAD requests or other background probes are sent.

References: [activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [content script isolation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [scripting](https://developer.chrome.com/docs/extensions/reference/api/scripting), [webRequest](https://developer.chrome.com/docs/extensions/reference/api/webRequest).

## Project structure

```text
extension/                  # Load this directory in Chrome
  manifest.json
  background.js             # Focus/permission gates, scans, ephemeral headers
  content/
    globals.js              # MAIN-world, self-contained global probe
    scripts.js              # ISOLATED-world script-tag probe
    sources.js              # ISOLATED-world, opt-in: same-origin script files
  shared/
    libraries.js            # Exactly 15 curated libraries
    detection.js            # Exact-host CDN parsing and evidence merging
    banners.js              # Licence banners in parsed comments (file check, batch)
    versions.js             # Version comparison and [introduced, fixed) ranges
    vulnerabilities.js      # Status calculation
    database.js             # Snapshot validation
    headers.js              # Header allowlist and document matching
  vendor/acorn.mjs          # Acorn 8.18.0 parser, unmodified (MIT)
  data/vulnerabilities.json # Generated data, independently refreshable
  popup/
    popup.html
    popup.css
    popup.js
    render.js               # Text-only DOM rendering, no HTML interpolation
  licenses/                 # Retire.js and Acorn licenses, included in extension
scripts/
  refresh-data.mjs
  validate-data.mjs
schema/vulnerabilities.schema.json
tests/                      # Unit tests and isolated Chrome integration test
tools/
  scan-sites.mjs            # Batch scan of many pages → HTML/JSON report
  banners.mjs               # Re-exports extension/shared/banners.js for the batch scanner
  urls.txt                  # Page list for npm run scan
LICENSE                     # MIT for original extension code
THIRD_PARTY_NOTICES.md
```

Vanilla JS avoids a framework, bundler, package download, and build step for this small popup. Native ES modules keep the worker and popup modular. The tradeoff is manual DOM rendering; `render.js` keeps that code in one place. Nothing is installed from npm at runtime; the one third-party code file is a vendored, unmodified copy of the Acorn parser, used only by the opt-in file check.

## Detection coverage

| Library | Global/version examples | npm package |
|---|---|---|
| jQuery | `jQuery.fn.jquery`, `$.fn.jquery` | `jquery` |
| AngularJS | `angular.version.full` | `angular` |
| React | `React.version` | `react` |
| React DOM | `ReactDOM.version` | `react-dom` |
| Vue | `Vue.version` | `vue` |
| Lodash | `_.VERSION` plus `_.runInContext` | `lodash` |
| Underscore | `_.VERSION` plus Underscore signatures | `underscore` |
| Moment | `moment.version` | `moment` |
| Bootstrap | `bootstrap.Tooltip.VERSION`, jQuery plugin constructors | `bootstrap` |
| Backbone | `Backbone.VERSION` | `backbone` |
| Handlebars | `Handlebars.VERSION` | `handlebars` |
| Axios | `axios.VERSION` | `axios` |
| D3 | `d3.version` when exposed | `d3` |
| Chart.js | `Chart.version` | `chart.js` |
| DOMPurify | `DOMPurify.version` | `dompurify` |

CDN parsing covers exact hostnames `cdnjs.cloudflare.com`, `cdn.jsdelivr.net`, `unpkg.com`, and `ajax.googleapis.com`. Versioned paths on those CDNs can identify a library when its global is absent. `@latest`, version ranges, omitted versions and major-only aliases establish presence but never an exact version. Google CDN Angular paths identify **AngularJS**, not modern Angular.

This is a curated starting set, not a measured popularity ranking. Multiple versions produce multiple rows; same-version global and CDN evidence are merged. An unresolved alias remains its own unknown row because it could refer to a different copy.

Known limits: closed-over bundles/ES modules, libraries only in cross-origin frames, custom CDN domains and renamed/removed globals can be invisible to the default scan; the opt-in file check below covers same-origin files that kept their licence banner. No script-body downloads unless that check is requested, and no source-map inspection, React DevTools hooks, response-body interception, or runtime behavior probing. A script tag is evidence of a reference, not proof that the request succeeded or its code executed. Globals and URLs can be spoofed by the page. Own-property getters are skipped; detection is best effort, not an integrity attestation. Click scan again for late-loaded scripts. A lightweight discovery call first identifies accessible documents without inspecting their globals or script tags. Library probes then inspect at most 2,000 script tags per frame and 50 selected documents (including the top page); combining frames never drops anything within those limits. Whenever a limit is reached, the popup and the batch report (terminal line, report banner and the page's row) say so.

## Self-hosted files (opt-in)

Libraries a site bundles into its own files (`/assets/vendor.min.js`) expose no global and no CDN URL, so the default scan cannot see them. **Check this site’s own script files** in the popup repeats the scan and also reads those files for the licence banner each library ships with, such as `/*! jQuery v1.12.4 | (c) jQuery Foundation */`.

- It runs only when that button is pressed; opening the popup or pressing ↻ never requests script files.
- Only scripts on the same origin as the page (or as a frame the activeTab grant covers) are requested. Other origins are never contacted, so custom CDN domains stay invisible.
- Requests are made from the `ISOLATED`-world probe with `cache: 'force-cache'`, so a file the page already loaded normally comes from Chrome’s cache. A file that is not cached is requested again from the site, with the page’s own cookies, as the page itself would. No new permission is needed, and the page’s Content Security Policy does not block it.
- Acorn parses each file without evaluating it; patterns inspect actual comments, never strings, template text or regex literals. Bodies are discarded after parsing; only library, version and the file’s host and path (no query string) are kept.
- Limits per check: 100 files, 4 MB per file, 24 MB in total. Files over a limit, unavailable, or not parseable are counted and reported in the popup as not inspected.
- Builds shipped without a version banner (lodash, React 18, most minified moment and axios 1.x) and bundles whose comments were stripped are not guessed. A banner is text in a file and can be spoofed or left stale.

## Status and advisory meaning

Precedence is **Vulnerable → Unknown for uncomparable ranges → maintenance notice → release comparison**.

- **Vulnerable:** the detected version matches one or more upstream security advisories. Some have CVE/GHSA identifiers; older upstream entries may have only a Retire.js reference. This is not proof of an exploitable browser vulnerability.
- **Outdated:** no vulnerability matched, and the version is behind the stable release in the snapshot, or upstream marks it end-of-life. An end-of-life notice alone is not presented as a CVE.
- **Current:** exactly matches the recorded stable version and no advisory matched. It does not mean safe or fully audited.
- **Unknown:** version/coverage/release information is missing, syntax cannot be compared, the version is newer than the snapshot, or an otherwise unmatched prerelease is detected.

The snapshot date is always visible, with a warning after 30 days. A bundled snapshot cannot know about advisories published after it was refreshed. Retire.js coverage is not exhaustive, including for libraries that currently have zero entries. npm’s `latest` tag is the release baseline, not an LTS/support-policy database.

Plain-English explanations use upstream CWE/summary categories and conditional language. The original summary, version intervals, identifier and advisory link remain available under each row. Server-side references are called out when the upstream summary explicitly mentions that context; other records retain unspecified applicability. Browser detection never proves that server-only code is in use. Server and X-Powered-By are displayed only as hints, without server vulnerability assessment.

## Refresh data independently

Use Node 22+:

```sh
npm run refresh:data
npm run validate:data
npm test
```

The installed extension makes no external data-update requests. The developer-run refresh script fetches the public [Retire.js v4 repository](https://raw.githubusercontent.com/RetireJS/retire.js/master/repository/jsrepository-v4.json) and the 15 public npm `latest` package records. It filters to the curated libraries, preserves the union of affected intervals, groups repeated advisory ranges, adds explanatory text, validates all versions, and atomically replaces `extension/data/vulnerabilities.json`. An unsupported source field, missing library, malformed response, timeout, or invalid version fails the refresh and leaves the old file untouched. It never evaluates upstream extractor expressions.

The schema records provenance, the SHA-256 of the complete downloaded Retire source, snapshot date, stable releases, source identifiers, severity, explanations, references and ranges. `introduced` is inclusive; `fixed` is exclusive. Null means no bound on that side. The runtime comparator accepts numeric versions, SemVer prereleases/build metadata, and the known legacy forms used by Retire.js (e.g. `1.9.0b1` and `1.0.0.beta.3`); unsupported versions are never assumed safe.

For an offline/reproducible refresh, supply previously downloaded inputs:

```sh
node scripts/refresh-data.mjs --retire-file /path/to/jsrepository-v4.json --releases-file /path/to/releases.json --as-of 2026-09-22T14:17:50.217Z
```

`releases.json` maps npm package names to exact stable versions, for example `{ "jquery": "4.0.0", ... }` with all 15 entries. For offline inputs, `--as-of` is required: use the oldest input’s actual retrieval date, not today’s date. The generated snapshot uses that date for freshness warnings. These are fixture inputs, not an installed-extension setting. Review the JSON diff after each refresh. For an unpacked extension, reload it in `chrome://extensions`. For distribution, ship the updated file in a new extension release. Data changes require no extension code change, but do require redistribution; v1 deliberately has no runtime updater.

## Testing

See [TESTING.md](TESTING.md) for the step-by-step local and remote-team checklist. Run `npm run demo` with Node 22+ to serve the bundled real-library demo at `http://127.0.0.1:8787`. No dependency install is needed. The demo runs separately from the extension.

`npm ci --ignore-scripts` installs the exact development-tool versions from the lockfile. `npm test` uses Node’s built-in test runner. It covers all 15 library definitions, all four CDN patterns, spoofed URLs, shared globals, multiple versions, unknown states, prereleases, inclusive/exclusive boundaries, import failure behavior, header allowlisting and stale-document rejection.

For browser and batch checks, install the Chromium revision pinned by Playwright:

```sh
npm ci --ignore-scripts
npx playwright install chromium
npm run validate:data
npm test
npm run test:browser
npm run test:batch
```

Both browser commands use disposable profiles and local fixtures. Tests include real activeTab grants, focus cancellation, header capture, frame budgets, hash routes, banner parsing and incomplete-coverage warnings. Set `CHROME_PATH` to a Chrome executable to test system Chrome, or `PLAYWRIGHT_MODULE` to a different development installation; omit both to use the locked tooling and its bundled Chromium. These tools are outside `extension/`; installing the extension and running the local demo still need no npm dependencies.

## Scan many pages at once

`npm run scan` drives the real extension over every URL in `tools/urls.txt` (one per line) in a disposable headless Chrome, and writes `scan-reports/<timestamp>/report.html` plus `report.json`. The report has a **fix list** (each library version once, with every page that loads it) and a per-page table of libraries, frames and headers. It needs Playwright and Chrome, set up exactly as for `npm run test:browser`.

The batch scanner also finds libraries in self-hosted and bundled files (`/assets/vendor.min.js`) by the licence banner each library ships with, such as `/*! jQuery v1.12.4 | (c) jQuery Foundation */`. It reads only script responses the page already received; no extra requests are made. Only the top page and same-origin frames count. Acorn parses the script without evaluating it; patterns inspect actual comments, never quoted strings, template text or regex literals. A banner must open with the library's own name, excluding jQuery UI and plugins' "requires jQuery v1.7" notes. Files that cannot be parsed are counted as incomplete coverage. These findings show as “file banner” evidence. Builds shipped without a version banner (lodash, React 18, most minified moment and axios 1.x) are not guessed. The extension reads script contents only through its opt-in file check, which uses the same banner matching.

```sh
npm run scan                                      # pages from tools/urls.txt
node tools/scan-sites.mjs https://example.org/    # or pass URLs directly
node tools/scan-sites.mjs --urls my-pages.txt --out reports/today --delay 5000 --no-headers
```

Each page is loaded once, then reloaded once for headers (`--no-headers` skips that), one page at a time with a 2-second pause (`--delay`). Nothing else is requested. **Only scan sites you are authorized to test.** Reports describe weaknesses; share them only with the site's owners.

## Build and verify a release

Version **0.2.1** adds the opt-in file check and a Linux header fix. The package and extension manifest must have the same version; the builder also verifies lockfile consistency and bundled data.

```sh
npm ci --ignore-scripts
npm run release
npm run release:verify
npm run release:test
```

Install the pinned Chromium first for `release:test`, or set `CHROME_PATH`. The builder writes `dist/rustline-dev-0.2.1.zip` and its `.sha256` sidecar. Inside the ZIP, `BUILD.json` records the version, a source-content digest, the data snapshot date, and hashes for every packaged source file. Fixed entry ordering, timestamps and modes make repeated builds byte-identical. `release:verify` compares every archived byte with current source; it rejects stale, missing or unexpected files. To verify another path, use `npm run release:verify -- /path/to/archive.zip`.

`release:test` builds twice, verifies reproducibility, extracts to a temporary directory, installs the locked dependencies, and runs data validation, unit tests, Chrome extension checks, and batch checks from the extracted copy. No profiles, reports, node_modules or dist files enter the ZIP. Refresh source and rebuild before sharing; do not reuse an old archive after edits.

The included `.github/workflows/ci.yml` runs on pushes and pull requests when this project folder is a GitHub repository's root. It checks unit tests on Linux, macOS and Windows, then validates the extracted release with Chromium on Linux and uploads the verified ZIP as a workflow artifact. Actions are pinned to commit IDs. The workflow does not publish to the Chrome Web Store.

## Scope and licensing

Chrome/MV3 only. No CMS, commerce, analytics, account, backend or telemetry features. Original code is MIT licensed. The bundled Retire.js-derived data is Apache-2.0; its license, copyright notice and modification notice are included. See `THIRD_PARTY_NOTICES.md`.
