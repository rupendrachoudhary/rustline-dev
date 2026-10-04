// End-to-end batch checks use only local responses and the real extension.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { main } from '../tools/scan-sites.mjs';

const resultPath = fileURLToPath(new URL('../test-results/batch/', import.meta.url));
await mkdir(resultPath, { recursive: true });
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', path.endsWith('.js') ? 'application/javascript' : 'text/html');
  response.setHeader('Content-Security-Policy', "script-src 'self' 'unsafe-inline'; frame-src http://127.0.0.1:* http://localhost:*; object-src 'none'");
  if (path === '/') response.end(`<script>window.jQuery={fn:{jquery:location.hash==='#/old'?'3.4.0':'4.0.0'}};</script>`);
  else if (path === '/quoted') response.end('<script src="/quoted.js"></script>');
  else if (path === '/quoted.js') response.end('const example="/*! jQuery v1.12.4 | jquery.org/license */"; const template=`/*! DOMPurify 2.2.0 */`; const pattern=/[/*! jQuery v1.12.4 */]/;');
  else if (path === '/real') response.end(`<script src="/vendor.js?token=not-retained"></script><iframe src="http://localhost:${server.address().port}/cross"></iframe>`);
  else if (path === '/vendor.js') response.end('/*! jQuery v1.12.4 | jquery.org/license */\n(()=>{const privateBundle={};})();');
  else if (path === '/cross') response.end('<script src="/foreign.js"></script>');
  else if (path === '/foreign.js') response.end('/*! Chart.js v2.9.4 */\nwindow.Chart={version:"2.9.4"};');
  else if (path === '/unsupported') response.end('<script src="/unsupported.js"></script>');
  else if (path === '/unsupported.js') response.end('/*! jQuery v1.12.4 */ const invalid = ;');
  else { response.statusCode = 404; response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
try {
  const routes = ['/#/old', '/#/new', '/quoted', '/real', '/unsupported'];
  const report = await main([...routes.map(route => origin + route), '--no-headers', '--delay', '0', '--out', resultPath]);
  assert.equal(report.pages.length, 5);
  for (const page of report.pages) assert.equal(page.error, undefined, JSON.stringify(page));
  assert.equal(report.pages[0].finalUrl, origin + '/#/old');
  assert.equal(report.pages[1].finalUrl, origin + '/#/new');
  assert.equal(report.pages[0].rows[0].version, '3.4.0');
  assert.equal(report.pages[1].rows[0].version, '4.0.0');
  console.log('PASS distinct hash routes retain their own detections');
  assert.deepEqual(report.pages[2].rows, []);
  assert.equal(report.pages[2].scriptsSkipped, 0);
  console.log('PASS quoted, template and regex examples create no library findings');
  assert.deepEqual(report.pages[3].rows.map(row => row.id), ['jquery']);
  assert.equal(report.pages[3].rows[0].version, '1.12.4');
  assert.equal(report.pages[3].rows[0].status, 'vulnerable');
  assert.equal(report.pages[3].rows[0].evidence[0].kind, 'banner');
  assert.equal(JSON.stringify(report.pages[3].rows).includes('not-retained'), false);
  console.log('PASS genuine private-bundle banner detected; cross-origin frame and query tokens excluded');
  assert.deepEqual(report.pages[4].rows, []);
  assert.equal(report.pages[4].scriptsSkipped, 1);
  assert.equal(report.pages[4].scriptsRead, 0);
  const html = await readFile(new URL('../test-results/batch/report.html', import.meta.url), 'utf8');
  assert.match(html, /unsupported JavaScript syntax/);
  assert.match(html, /1 page was not fully inspected/);
  console.log('PASS unparseable scripts are marked incomplete in the exported report');
  console.log('4 batch-browser checks passed.');
} finally { server.close(); server.closeAllConnections(); }
