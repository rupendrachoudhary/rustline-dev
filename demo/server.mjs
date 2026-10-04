import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const base = new URL('./', import.meta.url);
const assets = new Set(['jquery-3.4.0.min.js','moment-2.29.4.min.js','vue-3.5.43.min.js','axios-0.18.0.min.js']);
const html = clean => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>rustline.dev · Live demo</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f5ef;color:#292d26;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.wrap{max-width:1020px;margin:0 auto;padding:48px 42px 70px}header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #dedfd4;padding-bottom:25px}.brand{font-weight:750;font-size:25px;letter-spacing:-1px}.brand span{color:#a94728}.tag{font:11px ui-monospace,monospace;letter-spacing:1px;color:#66705e}.eyebrow{font:11px ui-monospace,monospace;letter-spacing:1.5px;color:#a94728;margin:40px 0 12px}h1{font-size:44px;line-height:1.1;letter-spacing:-1.9px;margin:0 0 18px;max-width:700px}.intro{max-width:690px;color:#646b5c;font-size:16px;margin:0 0 28px}.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin:28px 0}.step{border:1px solid #dfdfd3;background:#fffef9;padding:18px;border-radius:11px}.number{display:inline-block;color:#a94728;font:12px ui-monospace,monospace;margin-bottom:8px}.step strong{display:block;font-size:14px}.step p{font-size:12px;color:#707665;margin:6px 0 0}table{width:100%;border-collapse:collapse;background:#fffef9;border:1px solid #dfdfd3}th{text-align:left;font:10px ui-monospace,monospace;letter-spacing:.6px;color:#747b6a;padding:14px 18px;background:#f0f1e8}td{padding:17px 18px;border-top:1px solid #e8e8df;font-size:13px}td:first-child{font-weight:650}code{font:12px ui-monospace,monospace}.badge{font:10px ui-monospace,monospace;padding:5px 8px;border-radius:4px}.vulnerable{color:#943c21;background:#f9e8df}.outdated{color:#856229;background:#f5eedb}.current{color:#46654a;background:#e6efdf}.unknown{color:#676c61;background:#eceee6}.foot{display:flex;justify-content:space-between;gap:25px;padding-top:24px;font-size:12px;color:#7a806f}a{color:#a94728;text-underline-offset:4px}.note{color:#73796b;font-size:12px;margin:18px 0 0}.empty{padding:30px;border:1px solid #dfdfd3;background:#fffef9;border-radius:10px}#loaded{font-size:11px;color:#747b6a;margin-top:15px}
</style></head><body><div class="wrap"><header><div class="brand">rustline<span>.dev</span></div><div class="tag">LOCAL TEST DEMO · CHROME MV3</div></header><p class="eyebrow">${clean ? 'EMPTY-PAGE CHECK' : 'YOUR EXTENSION, RUNNING LIVE'}</p><h1>${clean ? 'Nothing to detect here.' : 'See what’s under the hood.'}</h1><p class="intro">${clean ? 'This page deliberately loads no supported libraries. Open rustline.dev again to see its empty state.' : 'This page loads four real JavaScript library builds from your computer. Open rustline.dev from Chrome’s toolbar to inspect them.'}</p><div class="steps"><div class="step"><span class="number">01 / OPEN</span><strong>Click rustline.dev</strong><p>Use its toolbar icon, or find it in Chrome’s puzzle-piece Extensions menu.</p></div><div class="step"><span class="number">02 / INSPECT</span><strong>Expand a flagged library</strong><p>Read why it matters, the matched advisory, and detection evidence.</p></div><div class="step"><span class="number">03 / HEADERS</span><strong>Reload to read headers</strong><p>Click the popup’s reload button, then reopen it. Scroll to Response headers.</p></div></div>${clean ? '<div class="empty">No third-party scripts are loaded on this page.</div>' : '<table><thead><tr><th>LIBRARY LOADED</th><th>BUILD</th><th>EXPECTED STATUS</th></tr></thead><tbody><tr><td>jQuery</td><td><code>3.4.0</code></td><td><span class="badge vulnerable">Vulnerable</span></td></tr><tr><td>Moment</td><td><code>2.29.4</code></td><td><span class="badge outdated">Outdated</span></td></tr><tr><td>Vue</td><td><code>3.5.43</code></td><td><span class="badge current">Current</span></td></tr><tr><td>Axios</td><td><code>0.18.0</code></td><td><span class="badge unknown">Unknown</span></td></tr></tbody></table><p class="note">This older Axios build has no public VERSION property. Its local script URL is not a supported CDN, so the extension correctly leaves the version unknown.</p><div id="loaded">Loading local libraries…</div>'}<div class="foot"><span>Real library detection · No exploit code · Statuses use the bundled snapshot</span><a href="${clean ? '/' : '/clean'}">${clean ? 'Back to library demo' : 'Try an empty page'} ↗</a></div></div>${clean ? '' : [...assets].map(name => `<script src="/assets/${name}"></script>`).join('') + `<script>document.getElementById('loaded').textContent='Loaded successfully: jQuery '+jQuery.fn.jquery+' · Moment '+moment.version+' · Vue '+Vue.version+' · Axios '+(typeof axios.get==='function'?'available (version not exposed)':'unavailable');</script>`}</body></html>`;

const server = createServer(async (req,res) => {
  let path;
  try { path = new URL(req.url, 'http://localhost').pathname; }
  catch { res.statusCode = 400; res.end(); return; }
  res.setHeader('Server','rustline-demo/1.0');
  res.setHeader('X-Powered-By','Node.js');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'; object-src 'none'");
  if (path.startsWith('/assets/') && assets.has(path.slice(8))) {
    try {res.setHeader('Content-Type','application/javascript');res.end(await readFile(new URL(`assets/${path.slice(8)}`,base)));}
    catch {res.statusCode=404;res.end();}
  } else if (path==='/' || path==='/clean') {res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html(path==='/clean'));}
  else {res.statusCode=404;res.end();}
});

const port = Number(process.env.PORT || 8787);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT must be an integer from 0 to 65535.');
  process.exit(1);
}
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE'
    ? `Port ${port} is already in use. Stop the previous demo or set PORT to another number.`
    : error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`rustline.dev test demo: http://127.0.0.1:${server.address().port}/`);
  console.log('Keep this terminal open. Press Ctrl+C to stop.');
  console.log('Load the extension/ folder in Chrome, then click rustline.dev on the demo page.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close();
  server.closeAllConnections();
});
