// Batch scan: drive the real, unmodified extension over a list of pages in a
// disposable Chrome profile, then write report.json and a self-contained
// report.html. Each page gets one normal load plus one reload for headers
// (skip with --no-headers). No other requests are made; pages are visited one
// at a time with a pause between them. Scan only sites you are authorized to test.
// Library banners are read from script responses the page already received
// (see banners.mjs); that adds evidence only this batch tool has.
//
//   node tools/scan-sites.mjs --urls tools/urls.txt [--out DIR] [--delay MS] [--no-headers]
//   node tools/scan-sites.mjs https://example.org/ https://example.org/other/
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectBanners, addBanners } from './banners.mjs';
import { validateDatabase } from '../extension/shared/database.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const extensionPath = resolve(root, 'extension');

function parseArgs(args) {
  const options = { urls: [], delay: 2000, headers: true, out: null, file: null };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--urls') options.file = args[++i];
    else if (arg === '--out') options.out = args[++i];
    else if (arg === '--delay') options.delay = Number(args[++i]);
    else if (arg === '--no-headers') options.headers = false;
    else if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}`);
    else options.urls.push(arg);
  }
  if (!Number.isFinite(options.delay) || options.delay < 0) throw new Error('--delay must be a number of milliseconds');
  return options;
}

// Whole-line comments start with #; a trailing note needs whitespace before its
// #. A # inside a URL is a fragment (hash routes like /#/admin) and is kept.
export function parseUrlList(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => line.replace(/\s+#.*$/, ''));
}

export async function loadUrls(options) {
  const urls = [...(options.file ? parseUrlList(await readFile(options.file, 'utf8')) : []), ...options.urls.map(url => url.trim()).filter(Boolean)];
  for (const url of urls) if (!/^https?:\/\//.test(url)) throw new Error(`Not an http(s) URL: ${url}`);
  if (!urls.length) throw new Error('No URLs. Usage: node tools/scan-sites.mjs --urls FILE  or  node tools/scan-sites.mjs URL...');
  return [...new Set(urls)];
}

async function until(fn, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

// Opens the extension popup for `page` exactly as a toolbar click would, and
// returns a function that evaluates code inside that popup.
async function openPopup(cdp, extensionId, page) {
  await page.bringToFront();
  for (const t of (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.url.endsWith('/popup/popup.html')))
    await cdp.send('Target.closeTarget', { targetId: t.targetId }).catch(() => {});
  const tabs = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos;
  const tab = tabs.find(t => t.url === page.url() && t.embedderData?.tabActive) || tabs.find(t => t.url === page.url());
  if (!tab) throw new Error('Could not find the browser tab to scan');
  await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: tab.targetId });
  const popupUrl = `chrome-extension://${extensionId}/popup/popup.html`;
  const popup = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url === popupUrl), 'extension popup');
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: popup.targetId, flatten: false });
  let sequence = 0;
  const waiting = new Map();
  const receive = event => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    waiting.get(message.id)?.(message);
    waiting.delete(message.id);
  };
  cdp.on('Target.receivedMessageFromTarget', receive);
  const evaluate = expression => new Promise((ok, fail) => {
    const id = ++sequence;
    const timer = setTimeout(() => { waiting.delete(id); fail(new Error('Popup did not respond')); }, 60000);
    waiting.set(id, message => {
      clearTimeout(timer);
      if (message.error || message.result.exceptionDetails) fail(new Error(JSON.stringify(message.error || message.result.exceptionDetails.text)));
      else ok(message.result.result.value);
    });
    cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }) }).catch(fail);
  });
  await until(() => evaluate(`document.readyState === 'complete' && !document.getElementById('rescan').disabled`), 'popup ready', 60000);
  const close = () => { cdp.off('Target.receivedMessageFromTarget', receive); return cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {}); };
  return { evaluate, close };
}

const MAX_SCRIPTS = 300;
const MAX_SCRIPT_BYTES = 8 * 1024 * 1024;

async function scanPage(context, cdp, extensionId, url, withHeaders, database) {
  const page = await context.newPage();
  // Latest body per script URL; a reload replaces the first load's entry. Like
  // the extension, only the top page and same-origin frames count, so
  // third-party embeds (ads, video players) stay out of the fix list.
  const scripts = new Map();
  const skipped = new Set();
  const inScope = response => {
    try {
      const frame = response.frame();
      return frame === page.mainFrame() || new URL(frame.url()).origin === new URL(page.url()).origin;
    } catch { return false; }
  };
  page.on('response', response => {
    if (response.request().resourceType() !== 'script' || !response.ok() || !inScope(response)) return;
    if (!scripts.has(response.url()) && scripts.size >= MAX_SCRIPTS) { skipped.add(response.url()); return; }
    scripts.set(response.url(), response.body().then(body => {
      if (body.length <= MAX_SCRIPT_BYTES) return body.toString('utf8');
      skipped.add(response.url());
      return null;
    }, () => { skipped.add(response.url()); return null; }));
  });
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000); // frames and late scripts
    let popup = await openPopup(cdp, extensionId, page);
    let scan = await popup.evaluate(`chrome.runtime.sendMessage({type:'scan'})`);
    if (withHeaders && scan?.ok) {
      const reloaded = await popup.evaluate(`chrome.runtime.sendMessage({type:'reload-headers'})`);
      await popup.close();
      if (reloaded?.ok) {
        await page.waitForLoadState('load', { timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(3000);
        popup = await openPopup(cdp, extensionId, page);
        scan = await popup.evaluate(`chrome.runtime.sendMessage({type:'scan'})`);
      }
    }
    await popup.close();
    if (!scan?.ok) return { url, finalUrl: page.url(), httpStatus: response?.status() ?? null, error: scan?.error || 'Scan failed' };
    const banners = [];
    for (const [scriptUrl, body] of scripts) {
      const inspected = inspectBanners(await body, scriptUrl);
      if (inspected.error) skipped.add(scriptUrl);
      banners.push(...inspected.banners);
    }
    return { url, finalUrl: page.url(), httpStatus: response?.status() ?? null, ...scan.result, rows: addBanners(scan.result.rows, banners, database), scriptsRead: [...scripts.keys()].filter(u => !skipped.has(u)).length, scriptsSkipped: skipped.size };
  } catch (error) {
    return { url, finalUrl: /^https?:/.test(page.url()) ? page.url() : url, error: error.message.split('\n')[0] };
  } finally {
    await page.close().catch(() => {});
  }
}

// Every limit that stopped inspection early, in words. A page with any of
// these was not fully covered, so "none detected" there proves even less.
export function coverageWarnings(page) {
  const warnings = [];
  if (page.truncated) warnings.push('A frame had more than 2,000 script tags; only the first 2,000 were inspected.');
  if (page.framesSkipped) warnings.push('More than 50 frames; only the first 50 were inspected.');
  if (page.unchecked) warnings.push(`${page.unchecked.toLocaleString('en')} script tags or globals across frames were not checked.`);
  if (page.scriptsSkipped) warnings.push(`${page.scriptsSkipped.toLocaleString('en')} script files could not be inspected for library banners (over ${MAX_SCRIPTS} files, larger than ${MAX_SCRIPT_BYTES / 1024 / 1024} MB, unavailable body, or unsupported JavaScript syntax).`);
  return warnings;
}

// Group identical library versions across pages: this is the fix list.
function summarize(pages) {
  const groups = new Map();
  for (const page of pages) for (const row of page.rows || []) {
    const key = `${row.id}@${row.version ?? '?'}`;
    if (!groups.has(key)) groups.set(key, { ...row, pages: [] });
    groups.get(key).pages.push(page.finalUrl || page.url);
  }
  const order = { vulnerable: 0, outdated: 1, unknown: 2, current: 3 };
  return [...groups.values()].sort((a, b) => order[a.status] - order[b.status] || b.pages.length - a.pages.length || a.name.localeCompare(b.name));
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeHref = url => /^https?:\/\//.test(url) ? esc(url) : '#';

function renderHtml(report) {
  const counts = { vulnerable: 0, outdated: 0, unknown: 0, current: 0 };
  for (const item of report.findings) counts[item.status]++;
  const advisories = item => [...item.advisories, ...item.maintenance].map(a => `
      <li><strong>${esc(a.aliases[0] || a.id)}</strong> <span class="sev ${esc(a.severity)}">${esc(a.severity)}</span> ${esc(a.summary)}
        <div class="muted">${esc(a.why)}</div>
        <div class="muted">Affected: ${esc(a.ranges.map(r => `${r.introduced ? `≥ ${r.introduced}` : 'any earlier'}${r.fixed ? `, < ${r.fixed}` : ''}`).join(' or '))}${a.references[0] ? ` · <a href="${safeHref(a.references.find(u => u.startsWith('https://')) || a.references[0])}" rel="noopener noreferrer">advisory</a>` : ''}</div></li>`).join('');
  const finding = item => `
    <details class="finding ${item.status}"${item.status === 'vulnerable' ? ' open' : ''}>
      <summary><span class="badge ${item.status}">${esc(item.status)}</span> <strong>${esc(item.name)} ${esc(item.version || 'version unknown')}</strong>
        <span class="muted">· latest ${esc(item.latest || 'n/a')} · on ${item.pages.length} page${item.pages.length === 1 ? '' : 's'}</span></summary>
      <p>${esc(item.advisories[0]?.why || item.reason)}</p>
      <p class="muted">Evidence: ${esc(item.evidence.map(e => e.detail).join(' | '))}</p>
      ${item.advisories.length || item.maintenance.length ? `<ul>${advisories(item)}</ul>` : ''}
      <p class="muted">Pages: ${item.pages.map(p => `<a href="${safeHref(p)}" rel="noopener noreferrer">${esc(p)}</a>`).join(', ')}</p>
    </details>`;
  const pageRow = page => `
    <tr><td><a href="${safeHref(page.finalUrl || page.url)}" rel="noopener noreferrer">${esc(page.finalUrl || page.url)}</a>${page.finalUrl && page.finalUrl !== page.url ? `<div class="muted">from ${esc(page.url)}</div>` : ''}</td>
      <td>${page.error ? `<span class="badge vulnerable">error</span> ${esc(page.error)}` : (page.rows.map(r => `<span class="badge ${r.status}">${esc(r.name)} ${esc(r.version || '?')}</span>`).join(' ') || '<span class="muted">none detected</span>')}${coverageWarnings(page).map(w => `<div class="coverage">⚠ Incomplete: ${esc(w)}</div>`).join('')}</td>
      <td>${esc(page.frames ?? '')}</td>
      <td>${page.headers === null || page.headers === undefined ? '<span class="muted">not observed</span>' : page.headers.length ? page.headers.map(h => `${esc(h.name)}: ${esc(h.value) || '<em>(empty)</em>'}`).join('<br>') : '<span class="muted">none sent</span>'}</td></tr>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>rustline.dev scan report</title><style>
:root{--bg:#f6f5ef;--card:#fffef9;--ink:#292d26;--muted:#6b7163;--line:#dedfd4;--red:#943c21;--redbg:#f9e8df;--amber:#856229;--amberbg:#f5eedb;--green:#46654a;--greenbg:#e6efdf;--grey:#676c61;--greybg:#eceee6}
@media (prefers-color-scheme:dark){:root{--bg:#1b1d19;--card:#23261f;--ink:#e8e8e0;--muted:#a0a595;--line:#3a3d34;--red:#f0a58c;--redbg:#4a2518;--amber:#e6c68a;--amberbg:#3f3420;--green:#a9cfa6;--greenbg:#26372a;--grey:#c3c7ba;--greybg:#34372f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 16px 60px}h1{margin:0 0 4px;font-size:26px}h2{margin:34px 0 12px;font-size:18px}
.muted{color:var(--muted);font-size:12.5px}a{color:inherit}.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:22px 0}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px}.tile b{display:block;font-size:26px}
.badge{display:inline-block;font:11px ui-monospace,monospace;padding:3px 7px;border-radius:4px;margin:1px 0;text-transform:uppercase}
.vulnerable{--c:var(--red);--b:var(--redbg)}.outdated{--c:var(--amber);--b:var(--amberbg)}.current{--c:var(--green);--b:var(--greenbg)}.unknown{--c:var(--grey);--b:var(--greybg)}
.badge{color:var(--c);background:var(--b)}.sev{font:11px ui-monospace,monospace;color:var(--muted)}
.finding{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--c);border-radius:8px;padding:12px 16px;margin:10px 0}
.finding summary{cursor:pointer}.finding ul{padding-left:18px}.finding li{margin:8px 0}
.table{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--card)}table{width:100%;border-collapse:collapse;min-width:720px}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-top:1px solid var(--line)}th{border-top:0;font:11px ui-monospace,monospace;color:var(--muted);text-transform:uppercase}
td a{word-break:break-all}.coverage{margin-top:6px;padding:6px 8px;border-radius:6px;background:var(--amberbg);color:var(--amber);font-size:12.5px}</style></head><body><main>
<h1>rustline.dev scan report</h1>
<p class="muted">Scanned ${esc(report.scannedAt)} · ${report.pages.length} page${report.pages.length === 1 ? '' : 's'} · vulnerability data ${esc(report.dataGeneratedAt?.slice(0, 10) || 'n/a')} (Retire.js snapshot)</p>
<div class="tiles">${Object.entries(counts).map(([k, v]) => `<div class="tile"><b>${v}</b><span class="badge ${k}">${k}</span> library versions</div>`).join('')}</div>
${(() => { const partial = report.pages.filter(p => !p.error && coverageWarnings(p).length).length; return partial ? `<p class="coverage">⚠ ${partial} page${partial === 1 ? ' was' : 's were'} not fully inspected, so libraries may be missing from this report. See the warnings in the Pages table.</p>` : ''; })()}
<h2>Fix list</h2><p class="muted">Each library version once, with every page that loads it. Vulnerable means the version matches a known advisory; whether it is exploitable depends on how the page uses it.</p>
${report.findings.map(finding).join('') || '<p class="muted">No supported libraries were detected.</p>'}
<h2>Pages</h2><div class="table"><table><thead><tr><th>Page</th><th>Libraries</th><th>Frames</th><th>Headers</th></tr></thead><tbody>${report.pages.map(pageRow).join('')}</tbody></table></div>
<h2>Limits</h2><p class="muted">Only the 15 libraries rustline.dev knows are checked. Self-hosted and bundled files are found by their library banner (“file banner” evidence); files whose banner was stripped, and libraries inside cross-site frames the extension cannot reach, may be missed, so “none detected” is not proof of absence. Findings reflect the bundled advisory snapshot, not live data.</p>
</main></body></html>`;
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const urls = await loadUrls(options);
  const database = validateDatabase(JSON.parse(await readFile(resolve(extensionPath, 'data/vulnerabilities.json'), 'utf8')));
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const outDir = resolve(options.out || resolve(root, 'scan-reports', new Date().toISOString().replace(/[:.]/g, '-')));
  const context = await chromium.launchPersistentContext('', {
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging']
  });
  const pages = [];
  try {
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
    for (const [index, url] of urls.entries()) {
      if (index) await new Promise(r => setTimeout(r, options.delay));
      process.stdout.write(`[${index + 1}/${urls.length}] ${url} … `);
      const result = await scanPage(context, cdp, id, url, options.headers, database);
      pages.push(result);
      console.log(result.error ? `error: ${result.error}` : `${result.rows.length} libraries (${result.rows.filter(r => r.status === 'vulnerable').length} vulnerable)${coverageWarnings(result).length ? ' — incomplete coverage, see report' : ''}`);
    }
  } finally {
    await context.close();
  }
  const report = {
    scannedAt: new Date().toISOString(),
    dataGeneratedAt: pages.find(p => p.generatedAt)?.generatedAt ?? null,
    pages, findings: summarize(pages)
  };
  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(resolve(outDir, 'report.html'), renderHtml(report));
  console.log(`\nReport: ${resolve(outDir, 'report.html')}`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
