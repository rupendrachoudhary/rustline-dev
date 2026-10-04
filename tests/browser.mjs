// Optional real-Chrome integration test. The shipped manifest is never modified.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const extensionPath = fileURLToPath(new URL('../extension/', import.meta.url));
const db = JSON.parse(await readFile(new URL('../extension/data/vulnerabilities.json', import.meta.url)));
const resultPath = new URL('../test-results/', import.meta.url);
await mkdir(resultPath, { recursive: true });

const fixture = `<!doctype html><meta charset="utf-8"><title>rustline.dev test fixture</title><h1>Local library fixture</h1>
<script>
window.jQuery = { fn: { jquery: '3.4.0' } };
window._ = { VERSION: '4.17.20', runInContext() {} };
window.Vue = { version: '${db.libraries.vue.latest}' };
window.axios = { get() {} };
</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js"></script>
<iframe src="/iframe"></iframe>`;
const server = createServer((request, response) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Server', 'rustline-test');
  response.setHeader('X-Powered-By', '<img src=x onerror=alert(1)>');
  response.setHeader('Set-Cookie', 'sensitive=do-not-retain');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-inline'; frame-src 'self'; object-src 'none'");
  if (request.url === '/iframe') response.end('<script>window.Backbone={VERSION:"0.4.0"}</script>');
  // Six frames of 2,000 script tags each, one CDN library last in every frame.
  // Tags inserted via innerHTML are listed in document.scripts but never fetched.
  else if (request.url === '/frames') response.end([0, 1, 2, 3, 4, 5].map(n => `<iframe src="/frame${n}"></iframe>`).join(''));
  else if (request.url === '/frame-budget') response.end(Array.from({length: 55}, (_, i) => `<iframe src="/budget-child?i=${i}"></iframe>`).join(''));
  else if (request.url.startsWith('/budget-child')) response.end('<script>window.React=new Proxy({}, {getOwnPropertyDescriptor(){window.probeReads=(window.probeReads||0)+1;return undefined;}});</script>');
  else if (/^\/frame\d$/.test(request.url)) {
    const library = ['jquery@3.4.0', 'vue@2.6.14', 'axios@0.21.1', 'moment@2.29.4', 'd3@7.8.5', 'dompurify@2.0.8'][request.url.at(-1)];
    response.end(`<div id="s"></div><script>document.getElementById('s').innerHTML = Array.from({length:1998}, (_, i) => '<script src="/f${request.url.at(-1)}s' + i + '.js"><\\/script>').join('') + '<script src="https://unpkg.com/${library}/x.js"><\\/script>';</script>`);
  }
  // Self-hosted bundle: no global, no CDN URL, only a licence banner. connect-src
  // 'none' shows the file check does not depend on the page's own policy.
  else if (request.url === '/selfhosted') {
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; connect-src 'none'");
    response.end(`<script src="/vendor.js?token=not-retained"></script><script src="/broken.js"></script><script src="http://localhost:${server.address().port}/foreign.js"></script>`);
  }
  else if (request.url.startsWith('/vendor.js')) { response.setHeader('Content-Type', 'application/javascript'); response.end('/*! jQuery v1.12.4 | jquery.org/license */\n(()=>{const privateBundle={};})();'); }
  else if (request.url === '/broken.js') { response.setHeader('Content-Type', 'application/javascript'); response.end('/*! jQuery v1.12.4 */ const invalid = ;'); }
  else if (request.url === '/foreign.js') { foreignRequests++; response.setHeader('Content-Type', 'application/javascript'); response.end('/*! Chart.js v2.9.4 */'); }
  else if (request.url === '/empty') response.end('<h1>No exposed libraries</h1>');
  else response.end(fixture);
});
let foreignRequests = 0;
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
let cdp;
let id;
let checks = 0;
let worker;
const passed = message => { checks++; console.log(`PASS ${message}`); };
async function until(fn, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await fn();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 75));
  }
  throw new Error(`Timed out: ${label}`);
}
async function attach(targetId) {
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: false });
  let sequence = 0;
  const waiting = new Map();
  const receive = event => {
    if (event.sessionId !== sessionId) return;
    const response = JSON.parse(event.message);
    const pending = waiting.get(response.id);
    if (!pending) return;
    waiting.delete(response.id);
    clearTimeout(pending.timer);
    if (response.error) pending.reject(new Error(response.error.message)); else pending.resolve(response.result);
  };
  cdp.on('Target.receivedMessageFromTarget', receive);
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++sequence;
    const timer = setTimeout(() => { waiting.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    waiting.set(requestId, { resolve, reject, timer });
    cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: requestId, method, params }) }).catch(reject);
  });
  return { send, async evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  }, async detach() { cdp.off('Target.receivedMessageFromTarget', receive); await cdp.send('Target.detachFromTarget', { sessionId }).catch(() => {}); } };
}
async function openPopup(page) {
  await page.bringToFront();
  const old = (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.url.endsWith('/popup/popup.html'));
  for (const target of old) await cdp.send('Target.closeTarget', { targetId: target.targetId }).catch(() => {});
  const tabs = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab', exclude: false }] })).targetInfos;
  const target = tabs.find(t => t.url === page.url() && t.embedderData?.tabActive) || tabs.find(t => t.url === page.url());
  assert.ok(target, 'Chrome tab target exists');
  await cdp.send('Extensions.triggerAction', { id, targetId: target.targetId });
  const popupTarget = await until(async () => (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url === `chrome-extension://${id}/popup/popup.html`), 'popup target');
  const popup = await attach(popupTarget.targetId);
  await until(() => popup.evaluate(`document.readyState === 'complete' && !document.getElementById('rescan').disabled`), 'popup scan');
  return popup;
}
try {
  context = await chromium.launchPersistentContext('', {
    headless: true,
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chromium' }),
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging']
  });
  cdp = await context.browser().newBrowserCDPSession();
  ({ id } = await cdp.send('Extensions.loadUnpacked', { path: extensionPath }));
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.testEvents = [];
    chrome.windows.onFocusChanged.addListener(id => testEvents.push({event:'focus',id}));
    chrome.tabs.onUpdated.addListener((id,change) => testEvents.push({event:'updated',id,change,time:Date.now()}));
    chrome.storage.onChanged.addListener((changes,area) => {if(area==='session')testEvents.push({event:'storage',changes});});
  });
  const page = context.pages()[0];
  // Fixture CSP blocks the CDN request. Detecting a tag does not prove execution.
  // No remote scripts or DevTools request interception are needed.
  await page.goto(origin);
  const grants = await worker.evaluate(() => chrome.permissions.getAll());
  assert.equal(grants.origins?.length || 0, 0);
  assert.ok(!grants.permissions.includes('tabs'));
  assert.deepEqual(await worker.evaluate(() => chrome.storage.session.get(null)), {});
  passed('no host grants or scans before user invocation');

  let popup = await openPopup(page);
  let report = await popup.evaluate(`chrome.windows.getCurrent().then(w => chrome.runtime.sendMessage({type:'scan',windowId:w.id}))`);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.result.rows.length, 6);
  assert.ok(report.result.rows.some(row => row.id === 'jquery' && row.status === 'vulnerable'));
  assert.ok(report.result.rows.some(row => row.id === 'moment' && row.version === '2.29.4'));
  assert.ok(report.result.rows.some(row => row.id === 'axios' && row.status === 'unknown'));
  assert.ok(report.result.rows.some(row => row.id === 'backbone' && row.version === '0.4.0' && row.evidence.some(e => e.detail.includes('(frame /iframe)'))));
  assert.equal(report.result.frames, 2);
  assert.equal(report.result.headers, null);
  passed('real activeTab grant, MAIN globals, CDN tags, unknown version, same-origin frame scanning');
  assert.ok((await popup.evaluate('document.body.innerText')).includes('Vulnerable'));
  passed('popup renders actual scan results');

  const navigation = page.waitForEvent('load');
  await popup.evaluate(`document.getElementById('reload').click()`);
  await navigation;
  await until(() => worker.evaluate(async () => (await chrome.storage.session.get('inspection')).inspection?.headers), 'response headers');
  await popup.detach();
  popup = await openPopup(page);
  report = await popup.evaluate(`chrome.windows.getCurrent().then(w => chrome.runtime.sendMessage({type:'scan',windowId:w.id}))`);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.result.headers, [{ name:'Server',value:'rustline-test' },{ name:'X-Powered-By',value:'<img src=x onerror=alert(1)>' }]);
  assert.equal(await popup.evaluate('document.querySelectorAll("img").length'), 0);
  const sessionData = await worker.evaluate(() => chrome.storage.session.get(null));
  assert.ok(!JSON.stringify(sessionData).includes('sensitive'));
  assert.ok(!JSON.stringify(sessionData).includes('/iframe'));
  passed('explicit reload captures two headers, excludes cookies, renders untrusted text safely');

  const dimensions = await popup.send('Page.getLayoutMetrics');
  const size = dimensions.cssContentSize || dimensions.contentSize;
  const capture = await popup.send('Page.captureScreenshot', { format:'png', captureBeyondViewport:true, clip:{x:0,y:0,width:420,height:size.height,scale:1} });
  await writeFile(new URL('popup.png', resultPath), Buffer.from(capture.data, 'base64'));
  assert.equal(await popup.evaluate('document.body.scrollWidth > document.body.clientWidth'), false);
  passed('popup screenshot and overflow check');
  await popup.detach();

  // A background tab never gains permission merely by loading or taking focus.
  const second = await context.newPage();
  await second.goto(`${origin}/empty`);
  await second.bringToFront();
  await until(() => worker.evaluate(async () => !(await chrome.storage.session.get('inspection')).inspection), 'clear selection on tab change');
  const rejected = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({active:true,lastFocusedWindow:true});
    try { await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>true}); return false; } catch { return true; }
  });
  assert.equal(rejected, true);
  passed('focus change clears selection and does not grant access to the new tab');

  popup = await openPopup(second);
  const empty = await popup.evaluate(`chrome.windows.getCurrent().then(w => chrome.runtime.sendMessage({type:'scan',windowId:w.id}))`);
  assert.equal(empty.ok, true, JSON.stringify(empty));
  assert.equal(empty.result.rows.length, 0);
  assert.equal(empty.result.headers, null);
  assert.equal(await popup.evaluate('document.getElementById("empty").hidden'), false);
  passed('empty page gets its own results, not stale libraries or headers');
  await popup.detach();

  // Switching windows mid-scan cancels it, even though the popup supplies its
  // windowId (which skips the initial focus check). A busy page holds the scan
  // inside executeScript while another window takes focus.
  popup = await openPopup(second);
  await second.evaluate(() => { setTimeout(() => { const end = Date.now() + 2000; while (Date.now() < end); }, 0); });
  const pending = popup.evaluate(`chrome.windows.getCurrent().then(w => chrome.runtime.sendMessage({type:'scan',windowId:w.id}))`);
  await new Promise(resolve => setTimeout(resolve, 300));
  const otherWindow = await worker.evaluate(async () => (await chrome.windows.create({ focused: true, url: 'about:blank' })).id);
  const cancelled = await pending;
  assert.equal(cancelled.ok, false, JSON.stringify(cancelled));
  assert.match(cancelled.error, /switched windows/);
  passed('focus change to another window cancels an in-progress scan');
  await popup.detach().catch(() => {});
  await worker.evaluate(id => chrome.windows.remove(id), otherWindow);
  await second.bringToFront();

  // A different origin revokes activeTab. No observer injects on navigation.
  await second.goto(origin.replace('127.0.0.1','localhost'));
  await until(() => worker.evaluate(async () => !(await chrome.storage.session.get('inspection')).inspection), 'origin change clears selection');
  passed('cross-origin navigation clears the selected inspection');

  // Aggregation across frames keeps every frame; limits reached are stated.
  const framed = await context.newPage();
  await framed.goto(`${origin}/frames`);
  await until(() => framed.evaluate(() => [...document.querySelectorAll('iframe')].every(f => f.contentDocument?.scripts.length === 2000)), 'frame scripts');
  popup = await openPopup(framed);
  const sixFrames = await popup.evaluate(`chrome.windows.getCurrent().then(w => chrome.runtime.sendMessage({type:'scan',windowId:w.id}))`);
  assert.equal(sixFrames.ok, true, JSON.stringify(sixFrames));
  assert.deepEqual(sixFrames.result.rows.map(r => r.id).sort(), ['axios', 'd3', 'dompurify', 'jquery', 'moment', 'vue']);
  assert.equal(sixFrames.result.frames, 7);
  assert.equal(sixFrames.result.unchecked, 0);
  assert.equal(await popup.evaluate('document.getElementById("message").textContent.includes("not checked")'), false);
  passed('six frames of 2,000 script tags each: all six libraries found, nothing unchecked');
  // Every coverage limit reaches the popup as an explicit warning.
  await popup.evaluate(`import('./render.js').then(({ renderReport }) => renderReport({ ...${JSON.stringify(sixFrames.result)}, truncated: true, framesSkipped: true, unchecked: 1234 }))`);
  const coverage = await popup.evaluate('document.getElementById("message").hidden ? "" : document.getElementById("message").textContent');
  for (const text of ['first 2,000 script tags', 'first 50 frames', '1,234 script tags or globals']) assert.ok(coverage.includes(text), coverage);
  passed('popup states every coverage limit that was reached');
  await popup.detach();
  await framed.close();

  const budgetPage = await context.newPage();
  await budgetPage.goto(`${origin}/frame-budget`);
  popup = await openPopup(budgetPage);
  const budget = await popup.evaluate(`chrome.windows.getCurrent().then(w => chrome.runtime.sendMessage({type:'scan',windowId:w.id}))`);
  assert.equal(budget.ok, true, JSON.stringify(budget));
  assert.equal(budget.result.frames, 50);
  assert.equal(budget.result.framesSkipped, true);
  const touched = await Promise.all(budgetPage.frames().filter(f => f !== budgetPage.mainFrame()).map(f => f.evaluate(() => (window.probeReads || 0) > 0)));
  assert.equal(touched.filter(Boolean).length, 49, 'only 49 children plus the top document receive library probes');
  passed('frame budget is applied before library probes; excess frames are not inspected');
  await popup.detach();
  await budgetPage.close();

  // Opt-in file check: same-origin script files only, and only on request.
  const hosted = await context.newPage();
  await hosted.goto(`${origin}/selfhosted`);
  popup = await openPopup(hosted);
  const plain = await popup.evaluate(`chrome.windows.getCurrent().then(w => chrome.runtime.sendMessage({type:'scan',windowId:w.id}))`);
  assert.equal(plain.ok, true, JSON.stringify(plain));
  assert.deepEqual(plain.result.rows, []);
  assert.equal(plain.result.files, null);
  const foreignBefore = foreignRequests;
  await popup.evaluate(`document.getElementById('files').click()`);
  await until(() => popup.evaluate(`!document.getElementById('files').disabled && !document.getElementById('results').hidden`), 'file check');
  const hostedText = await popup.evaluate('document.body.innerText');
  assert.ok(hostedText.includes('jQuery') && hostedText.includes('1.12.4') && hostedText.includes('Vulnerable'), hostedText);
  assert.ok(hostedText.includes('1 script file could not be inspected'), hostedText);
  const deep = await popup.evaluate(`chrome.windows.getCurrent().then(w => chrome.runtime.sendMessage({type:'scan-files',windowId:w.id}))`);
  assert.equal(deep.ok, true, JSON.stringify(deep));
  assert.deepEqual(deep.result.rows.map(row => `${row.id}@${row.version}:${row.status}`), ['jquery@1.12.4:vulnerable']);
  assert.deepEqual(deep.result.rows[0].evidence, [{ kind: 'banner', detail: `file banner · 127.0.0.1:${server.address().port}/vendor.js` }]);
  assert.deepEqual(deep.result.files, { read: 1, skipped: 1 });
  assert.equal(JSON.stringify(deep).includes('not-retained'), false);
  assert.equal(foreignRequests, foreignBefore, 'other origins are never requested');
  passed('opt-in file check finds a self-hosted banner under a strict page CSP; other origins and query tokens excluded');
  await popup.detach();
  await hosted.close();

  const networkPermissions = await worker.evaluate(() => chrome.runtime.getManifest().host_permissions || []);
  assert.deepEqual(networkPermissions, []);
  console.log(`${checks} browser checks passed. Screenshot: ${fileURLToPath(new URL('popup.png', resultPath))}`);
} catch(error) {
  if(worker) console.error('Browser diagnostic:', JSON.stringify(await worker.evaluate(() => globalThis.testEvents).catch(() => [])));
  throw error;
} finally {
  await context?.close();
  server.close();
}
