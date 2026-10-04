// Runs in the ISOLATED world of each accessible frame, only after the user asks
// for the file check. Reads this site's own script files (same origin as the
// frame) so their licence banners can be matched; other origins are never
// requested. The HTTP cache is preferred, so a file the page already loaded is
// usually not requested again. Queries/fragments are used for the request but
// never returned. Nothing is evaluated.
export async function readSources(seen, maxFiles, maxBytes, maxTotal) {
  const known = new Set(seen);
  const targets = [];
  let skipped = 0;
  let count = 0;
  for (const script of document.scripts) {
    if (++count > 2000) break; // Mirrored in shared/detection.js MAX_URLS.
    if (!script.src) continue;
    const type = (script.type || '').trim().toLowerCase().split(';')[0].trim();
    if (!['', 'module', 'text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript'].includes(type)) continue;
    let url;
    try { url = new URL(script.src, document.baseURI); } catch { continue; }
    if (url.origin !== location.origin || (url.protocol !== 'https:' && url.protocol !== 'http:')) continue;
    const where = `${url.origin}${url.pathname}`.slice(0, 2048);
    if (known.has(where)) continue;
    known.add(where);
    if (targets.length >= maxFiles) { skipped++; continue; }
    url.hash = '';
    targets.push({ where, href: url.href });
  }
  const files = [];
  let total = 0;
  for (const { where, href } of targets) {
    try {
      const response = await fetch(href, { mode: 'same-origin', cache: 'force-cache', signal: AbortSignal.timeout(10000) });
      if (!response.ok || Number(response.headers.get('content-length')) > maxBytes) { skipped++; continue; }
      const text = await response.text();
      if (text.length > maxBytes || total + text.length > maxTotal) { skipped++; continue; }
      total += text.length;
      files.push({ where, text });
    } catch { skipped++; }
  }
  return { files, skipped, seen: targets.map(target => target.where) };
}
