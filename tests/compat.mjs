// Older-Chrome compatibility check, e.g. the manifest's minimum version:
//   CHROME_PATH="/path/to/chrome-120" npm run test:compat
// browser.mjs needs CDP commands (Extensions.loadUnpacked, triggerAction) that
// old Chrome lacks, so the toolbar click cannot be automated there. This check
// instead loads a temporary COPY of the extension that is granted the local
// fixture host and exposes the worker's entry points. The shipped files are
// never modified. Everything after the click is exercised in the old browser:
// worker start-up, both probes, frames, the file check, headers and rendering.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
if (!process.env.CHROME_PATH) throw new Error('Set CHROME_PATH to the Chrome executable to check.');

const temporary = await mkdtemp(join(tmpdir(), 'rustline-compat-'));
const extensionPath = join(temporary, 'extension');
await cp(fileURLToPath(new URL('../extension/', import.meta.url)), extensionPath, { recursive: true });
const manifest = JSON.parse(await readFile(join(extensionPath, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(join(extensionPath, 'manifest.json'), JSON.stringify(manifest));
await appendFile(join(extensionPath, 'background.js'), '\nglobalThis.rustlineTest = { scanFocusedTab, scanFiles, reloadForHeaders };\n');

const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Server', 'rustline-test');
  response.setHeader('X-Powered-By', 'compat');
  response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
  if (path === '/') response.end(`<title>compat</title><script>window.jQuery={fn:{jquery:'3.4.0'}};</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js"></script><iframe src="/iframe"></iframe>`);
  else if (path === '/iframe') response.end('<script>window.Backbone={VERSION:"0.4.0"}</script>');
  else if (path === '/selfhosted') {
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'none'");
    response.end('<title>selfhosted</title><script src="/vendor.js?token=not-retained"></script>');
  }
  else if (path === '/vendor.js') response.end('/*! jQuery v1.12.4 | jquery.org/license */\n(()=>{const privateBundle={};})();');
  else { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
let checks = 0;
const passed = message => { checks++; console.log(`PASS ${message}`); };
try {
  context = await chromium.launchPersistentContext('', {
    headless: false, executablePath: process.env.CHROME_PATH,
    args: ['--headless=new', `--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const version = context.browser().version();
  assert.ok(Number(version.split('.')[0]) >= Number(manifest.minimum_chrome_version), version);
  await worker.evaluate(async () => { for (let i = 0; i < 100 && !globalThis.rustlineTest; i++) await new Promise(resolve => setTimeout(resolve, 50)); });
  const call = (name, url) => worker.evaluate(async ({ name, url }) => {
    const [tab] = await chrome.tabs.query({ url });
    try { return { ok: true, result: await rustlineTest[name](tab.windowId) }; } catch (error) { return { ok: false, error: error.message }; }
  }, { name, url: url.replace(/:\d+/, '') + '*' });
  passed(`extension worker starts in Chrome ${version}`);

  const page = context.pages()[0] || await context.newPage();
  await page.goto(`${origin}/`);
  await page.bringToFront();
  let report = await call('scanFocusedTab', `${origin}/`);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.result.rows.map(row => `${row.id}@${row.version}:${row.status}`).sort(), ['backbone@0.4.0:vulnerable', 'jquery@3.4.0:vulnerable', 'moment@2.29.4:outdated']);
  assert.equal(report.result.frames, 2);
  passed('MAIN-world globals, CDN script URLs and a same-origin frame are detected and assessed');

  const navigation = page.waitForEvent('load');
  assert.equal((await call('reloadForHeaders', `${origin}/`)).ok, true);
  await navigation;
  for (let i = 0; i < 100 && !await worker.evaluate(async () => (await chrome.storage.session.get('inspection')).inspection?.headers); i++) await new Promise(resolve => setTimeout(resolve, 75));
  report = await call('scanFocusedTab', `${origin}/`);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.result.headers, [{ name: 'Server', value: 'rustline-test' }, { name: 'X-Powered-By', value: 'compat' }]);
  passed('reload captures Server and X-Powered-By');

  await page.goto(`${origin}/selfhosted`);
  const plain = await call('scanFocusedTab', `${origin}/`);
  assert.equal(plain.ok, true, JSON.stringify(plain));
  assert.deepEqual(plain.result.rows, []);
  const files = await call('scanFiles', `${origin}/`);
  assert.equal(files.ok, true, JSON.stringify(files));
  assert.deepEqual(files.result.rows.map(row => `${row.id}@${row.version}:${row.status}`), ['jquery@1.12.4:vulnerable']);
  assert.deepEqual(files.result.files, { read: 1, skipped: 0 });
  assert.equal(JSON.stringify(files).includes('not-retained'), false);
  passed('file check reads a same-origin banner under a strict page CSP');

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${worker.url().split('/')[2]}/popup/popup.html`);
  await popup.evaluate(result => import('./render.js').then(({ renderReport }) => renderReport(result)), files.result);
  const text = await popup.evaluate(() => document.body.innerText);
  assert.ok(text.includes('jQuery') && text.includes('Vulnerable') && text.includes('Read 1 script file'), text);
  passed('popup renders the report');
  console.log(`${checks} compatibility checks passed in Chrome ${version}.`);
} finally {
  await context?.close();
  server.close(); server.closeAllConnections();
  await rm(temporary, { recursive: true, force: true });
}
