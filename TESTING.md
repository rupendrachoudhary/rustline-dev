# Test rustline.dev locally or with your team

## 1. Install the extension

1. Extract `rustline-dev.zip` into a permanent folder. Do not load the ZIP itself.
2. Use desktop Google Chrome 120 or later; a current stable Chrome is recommended.
3. Type `chrome://extensions` into Chrome's address bar.
4. Turn on **Developer mode** in the top-right corner.
5. Click **Load unpacked**. Inside the extracted `rustline-dev` folder, select **extension**. This is the folder containing `manifest.json`; do not select its parent.
6. Confirm rustline.dev version **0.2.2** appears and is enabled.
7. Open Chrome's puzzle-piece menu and pin rustline.dev to the toolbar.

There is no build step or dependency installation. Chrome documents this process at https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked.

## 2. Start the repeatable demo

The extension itself needs only Chrome. The optional local demo and automated tests need **Node.js 22+** (https://nodejs.org/en/download), which includes npm.

1. Open Terminal (macOS/Linux) or PowerShell (Windows).
2. Change directory to the extracted **rustline-dev** folder containing `package.json`. Type `cd `, then drag the folder into the terminal on macOS, or use `cd "C:\path\to\rustline-dev"` in PowerShell.
3. Check the runtime with `node --version`; it must report v22 or newer.
4. Run:

   ```sh
   npm run demo
   ```

   No `npm install` is needed. If PowerShell blocks `npm.ps1`, use `node demo/server.mjs` instead; no execution-policy change is needed.

5. Leave that terminal open and visit **http://127.0.0.1:8787/** in the Chrome profile where you installed the extension.
6. Confirm the page says the four libraries loaded successfully.
7. Click the rustline.dev toolbar icon while this tab is in focus.

If port 8787 is occupied, stop your earlier demo with Ctrl+C. Alternatively set another port: `PORT=8788 npm run demo` on macOS/Linux, or `$env:PORT=8788` followed by `npm run demo` in PowerShell. Open the URL printed in the terminal.

The demo serves bundled scripts locally and needs no network connection after extraction. It is test tooling, not an extension backend. Press **Ctrl+C** in the terminal to stop it.

## 3. Check the results

These expectations are for the bundled 2026-09-22 vulnerability snapshot. Keep the same snapshot across testers; do not refresh the database midway through a comparison.

| Check | Action | Expected result |
| --- | --- | --- |
| Known vulnerability | Open the popup on the demo | jQuery **3.4.0 — Vulnerable** |
| Explanation | Expand jQuery's advisory details | Plain-English explanation, detection evidence, CVE-2020-11022 and CVE-2020-11023 |
| Old release | Inspect Moment | **2.29.4 — Outdated** |
| Snapshot-current release | Inspect Vue | **3.5.43 — Current** |
| Missing version | Inspect Axios | **Unknown**, with no invented version; this build exposes no VERSION property |
| Headers | Scroll down, click **Reload page to read headers**, wait, then reopen the popup | **Server: rustline-demo/1.0** and **X-Powered-By: Node.js** |
| Empty page | Close the popup, click **Try an empty page**, reopen rustline.dev | No detected libraries; old rows disappear |
| Switch tabs | Open the demo and empty page in separate tabs; open the popup on each | Each scan reflects the currently focused page |
| Restricted page | Open the popup on `chrome://extensions` | An explanatory error; no scan results for that page |

Reloading a page can reset its unsaved state. Header capture requires the page to remain focused during the reload. A first scan can have no headers because the response occurred before permission was granted.

To exercise the script-URL parser and version boundaries reproducibly, use the automated tests below. The manual demo above uses real browser globals with locally served scripts.

## 4. Try your own website

1. Open your website over HTTP or HTTPS in the same Chrome profile.
2. Keep that tab and Chrome window focused, then click rustline.dev.
3. Compare detected names/versions with your app's actual dependencies and exposed globals or supported CDN URLs.
4. If your app loads a library later, trigger that interaction, then click the popup's circular rescan button.
5. Use the explicit reload button to check the two supported response headers.
6. If your site bundles libraries into its own files, click **Check this site’s own script files** and confirm the versions it reports against your dependencies.

No result is not proof that a library is absent: bundles whose licence comments were stripped, modules, libraries only in cross-origin frames, and custom CDN paths may be invisible. Current means current in the bundled snapshot. A matched advisory does not prove the vulnerable feature is reachable on that page.

The extension uses an explicit click to obtain `activeTab`; focusing a tab alone does not authorize a scan. See https://developer.chrome.com/docs/extensions/develop/concepts/activeTab.

## 5. Remote-team workflow

1. Send the same `rustline-dev.zip` file and this checklist through your team's normal file-sharing channel, or commit the source to your chosen repository and share one commit/tag. Sending this file does not publish the extension.
2. Each tester extracts it and completes sections 1–3 on their own computer. Keep the extracted directory in place while the extension is installed.
3. Each tester runs their own local demo. **Your localhost URL points to your computer; their localhost URL points to theirs.** No port forwarding, shared backend, or access to your computer is needed.
4. Ask testers to record their OS, Chrome version (`chrome://version`), extension version, database snapshot date, and pass/fail results from the table.
5. For a failure, collect the page URL or demo case, exact steps, expected versus actual result, and a popup screenshot. If Chrome shows an **Errors** button on the extension card, include its relevant error text.
6. For updates, distribute a new versioned ZIP or repository commit. Replace the files in the installed folder, click rustline.dev's **Reload** icon in `chrome://extensions`, then reload the test page. Unpacked installs do not receive automatic updates from this project.

If an organization manages Chrome and disables Developer mode, the tester must ask their IT administrator for an approved testing path.

## 6. Automated developer checks

Run from the project folder using Node 22+. Install the locked development tools first:

```sh
npm ci --ignore-scripts
npm run validate:data
npm test
```

Dependency installation is only needed for development checks and the batch scanner; the extension and local demo work without it. These checks validate the bundled data and cover all 15 library definitions, the four supported CDN patterns, version ranges, unknown states, and header filtering.

Optional real-browser integration tests need Playwright tooling:

```sh
npx playwright install chromium
npm run test:browser
npm run test:batch
```

This separate test uses a disposable browser profile and local fixtures. It checks the real extension's permission grant, popup, header capture, focus changes, and navigation behavior. It requires a recent bundled Chromium with the CDP Extensions domain; see README.md for custom Chrome and Playwright paths.

To validate the actual distributable, run `npm run release:test` after installing Chromium. Share the resulting versioned ZIP in `dist/`, together with its SHA-256 sidecar. It includes a `BUILD.json` that distinguishes releases even when comparing multiple test builds.

## Bug report template

```text
Tester:
OS / Chrome version:
Extension version / shared ZIP or commit:
Database snapshot date / BUILD.json sourceSha256:
Page URL or demo case:
Steps to reproduce:
Expected:
Actual:
Screenshot / relevant extension error:
```
