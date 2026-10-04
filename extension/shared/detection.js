import { LIBRARIES, BY_ID } from './libraries.js';
import { exactVersion, customBuildVersion } from './versions.js';

export function detectScript(source) {
  let url;
  try { url = new URL(source); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  let packageName, version, match;
  // Match the hostname exactly, never a URL substring or a query parameter.
  if (url.hostname === 'cdnjs.cloudflare.com') {
    match = url.pathname.match(/^\/ajax\/libs\/([^/]+)\/([^/]+)\/.+\.(?:m?js)$/i);
    if (match) [, packageName, version] = match;
  } else if (url.hostname === 'cdn.jsdelivr.net') {
    match = url.pathname.match(/^\/npm\/([^/@]+)(?:@([^/]+))?(?:\/.*)?$/);
    if (match) [, packageName, version] = match;
  } else if (url.hostname === 'unpkg.com') {
    match = url.pathname.match(/^\/([^/@]+)(?:@([^/]+))?(?:\/.*)?$/);
    if (match) [, packageName, version] = match;
  } else if (url.hostname === 'ajax.googleapis.com') {
    match = url.pathname.match(/^\/ajax\/libs\/([^/]+)\/([^/]+)\/.+\.js$/i);
    if (match) [, packageName, version] = match;
  }
  if (!packageName) return null;
  // npm-based CDN paths use exact npm package identities.
  const npmCDN = ['cdn.jsdelivr.net', 'unpkg.com'].includes(url.hostname);
  const library = LIBRARIES.find(l => npmCDN ? l.npm === packageName : l.cdn.includes(packageName));
  if (!library) return null;
  try { version = decodeURIComponent(version || ''); } catch { version = ''; }
  return { id: library.id, version: exactVersion(version), evidence: `${url.hostname} · ${url.pathname.slice(0, 240)}`, kind: 'script' };
}

// Aggregate bounds are the per-frame caps times the frame cap, so merging never
// cuts off what the frames returned (content/scripts.js stops at 2,000 tags,
// content/globals.js at 100 results; keep those in step with these). If they
// ever drift, the overflow is counted in `unchecked` for the caller to show;
// nothing is dropped silently. Per-frame and frame-count limits are reported
// separately as `truncated` and `framesSkipped`.
export const MAX_FRAMES = 50;
const MAX_URLS = MAX_FRAMES * 2000;
const MAX_GLOBALS = MAX_FRAMES * 100;

// Returns { rows, unchecked }: unchecked counts inputs beyond the bounds.
export function mergeDetections(globals, urls) {
  const rows = new Map();
  const globalItems = Array.isArray(globals) ? globals : [];
  // Frames often load the same scripts; count each URL once.
  const urlItems = Array.isArray(urls) ? [...new Set(urls)] : [];
  const unchecked = Math.max(0, globalItems.length - MAX_GLOBALS) + Math.max(0, urlItems.length - MAX_URLS);
  const input = [
    ...globalItems.slice(0, MAX_GLOBALS).map(x => ({ ...x, kind: 'global' })),
    ...urlItems.slice(0, MAX_URLS).map(detectScript).filter(Boolean)
  ];
  for (const item of input) {
    if (!item || !BY_ID.has(item.id) || typeof item.evidence !== 'string') continue;
    let version = exactVersion(item.version);
    let detail = item.evidence;
    if (!version && item.kind === 'global' && typeof item.version === 'string') {
      version = customBuildVersion(item.version);
      // Show what the page reported so an unresolved version can be checked by hand.
      detail += version ? ' (custom build)' : ` reported "${item.version.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 60)}"`;
    }
    const key = `${item.id}@${version ?? '?'}`;
    if (!rows.has(key)) rows.set(key, { id: item.id, name: BY_ID.get(item.id).name, version, evidence: [] });
    const row = rows.get(key);
    const evidence = { kind: item.kind, detail: detail.slice(0, 300) };
    if (row.evidence.length < 8 && !row.evidence.some(e => e.kind === evidence.kind && e.detail === evidence.detail)) row.evidence.push(evidence);
  }
  // Preserve multiple versions, including an unresolved URL alias. A global
  // version does not prove what a separate @latest script actually loaded.
  return { rows: [...rows.values()], unchecked };
}
