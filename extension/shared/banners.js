// Library banners: the licence comment a library ships at the top of its own
// file (/*! jQuery v3.4.1 | ... */). Used by the popup's opt-in file check
// (same-origin scripts only, see content/sources.js) and by the batch scanner.
//
// A banner counts only when the library name opens the comment, so plugin notes
// ("Requires jQuery v1.7+"), jQuery UI/Migrate and developer TODOs never match.
// Builds that ship without a banner (lodash, React 18, most minified moment)
// are not guessed.
import { BY_ID } from './libraries.js';
import { exactVersion } from './versions.js';
import { assessAll } from './vulnerabilities.js';
import { parse } from '../vendor/acorn.mjs';

const V = String.raw`v?(\d+\.\d+\.\d+(?:-[\da-z.-]+)?)`;
const PATTERNS = [
  ['jquery', new RegExp(String.raw`^jQuery (?:JavaScript Library )?${V}\b`)],
  ['angularjs', new RegExp(String.raw`^AngularJS ${V}\b`)],
  [match => match[2], new RegExp(String.raw`^React ${V} (react|react-dom)\.[\w.-]*js\b`)],
  ['vue', new RegExp(String.raw`^(?:Vue\.js|vue) ${V}\b`)],
  ['underscore', new RegExp(String.raw`^Underscore\.js ${V}\b`)],
  ['moment', new RegExp(String.raw`^moment\.js version ?: ?${V}\b`)],
  ['bootstrap', new RegExp(String.raw`^Bootstrap ${V}\b`)],
  ['backbone', new RegExp(String.raw`^Backbone\.js ${V}\b`)],
  ['handlebars', new RegExp(String.raw`^handlebars ${V}\b`, 'i')],
  ['axios', new RegExp(String.raw`^[Aa]xios ${V}\b`)],
  ['d3', new RegExp(String.raw`^https?://d3js\.org ${V}\b`)],
  ['chartjs', new RegExp(String.raw`^Chart\.js (?:${V}\b|https?://\S+ Version: ${V}\b)`)],
  ['dompurify', new RegExp(String.raw`^DOMPurify ${V}\b`)]
];

// Parse, rather than tokenize with heuristics: regex literals depend on the
// surrounding JavaScript grammar. Never evaluate downloaded code. A failed
// parse discards all candidates, and the caller reports incomplete coverage.
function comments(source) {
  const tokens = [];
  parse(source, {
    ecmaVersion: 'latest', sourceType: 'script',
    allowImportExportEverywhere: true, allowAwaitOutsideFunction: true,
    onComment(block, text, start, end) { tokens.push({ block, start, end }); }
  });
  const candidates = [];
  let run = null;
  for (const token of tokens) {
    if (token.block) {
      if (run) candidates.push(source.slice(run.start, run.end));
      run = null;
      candidates.push(source.slice(token.start, Math.min(token.end, token.start + 4000)));
    } else if (/^[ \t]*$/.test(source.slice(source.lastIndexOf('\n', token.start - 1) + 1, token.start))) {
      if (run && /^[ \t]*\r?\n[ \t]*$/.test(source.slice(run.end, token.start))) run.end = token.end;
      else { if (run) candidates.push(source.slice(run.start, run.end)); run = token; }
    } else { if (run) candidates.push(source.slice(run.start, run.end)); run = null; }
  }
  if (run) candidates.push(source.slice(run.start, run.end));
  return candidates;
}
function normalize(comment) {
  return comment.replace(/^\/\*+!?/, '').replace(/\*\/$/, '')
    .split('\n').map(line => line.replace(/^\s*(?:\/\/!?|\*+)?\s*/, '')).join(' ')
    .replace(/@license\b/g, ' ').replace(/\s+/g, ' ').trim();
}

export function inspectBanners(source, url) {
  if (typeof source !== 'string') return { banners: [], error: 'Script body unavailable.' };
  let candidates;
  try { candidates = comments(source); }
  catch { return { banners: [], error: 'Script syntax could not be parsed; banner inspection skipped.' }; }
  let where;
  try { const parsed = new URL(url); where = `${parsed.host}${parsed.pathname}`.slice(0, 240); } catch { where = 'inline script'; }
  const found = new Map();
  for (const comment of candidates) {
    const text = normalize(comment);
    for (const [id, pattern] of PATTERNS) {
      const match = text.match(pattern);
      const version = match && exactVersion(match.slice(1).find(x => x && /^v?\d/.test(x)));
      const libraryId = match && (typeof id === 'function' ? id(match) : id);
      if (version && BY_ID.has(libraryId)) found.set(`${libraryId}@${version}`, { id: libraryId, version, evidence: `file banner · ${where}` });
    }
  }
  return { banners: [...found.values()], error: null };
}

export function detectBanners(source, url) { return inspectBanners(source, url).banners; }

// Adds banner findings to the extension's rows: same library and version gains
// evidence, anything else becomes its own row. Every row is re-assessed.
export function addBanners(rows, banners, database) {
  const detections = rows.map(({ id, name, version, evidence }) => ({ id, name, version, evidence: [...evidence] }));
  for (const banner of banners) {
    let row = detections.find(r => r.id === banner.id && r.version === banner.version);
    if (!row) detections.push(row = { id: banner.id, name: BY_ID.get(banner.id).name, version: banner.version, evidence: [] });
    if (row.evidence.length < 8 && !row.evidence.some(e => e.detail === banner.evidence)) row.evidence.push({ kind: 'banner', detail: banner.evidence });
  }
  return assessAll(detections, database);
}
