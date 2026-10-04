// Runs in the ISOLATED world of each accessible frame. Reading script tags does not fetch
// their content. Queries/fragments are never returned or retained.
export function inspectScripts() {
  const urls = [];
  let count = 0;
  for (const script of document.scripts) {
    if (++count > 2000) break; // Mirrored in shared/detection.js MAX_URLS.
    if (!script.src) continue;
    const type = (script.type || '').trim().toLowerCase().split(';')[0].trim();
    if (!['', 'module', 'text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript'].includes(type)) continue;
    try {
      const url = new URL(script.src, document.baseURI);
      if (url.protocol === 'https:' || url.protocol === 'http:') urls.push(`${url.origin}${url.pathname}`.slice(0, 2048));
    } catch { /* Invalid or non-network source. */ }
  }
  return { urls, frame: location.pathname.slice(0, 240), timeOrigin: performance.timeOrigin, responseEnd: performance.getEntriesByType('navigation')[0]?.responseEnd || 0, truncated: count > 2000 };
}
