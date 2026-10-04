import { LIBRARIES } from './shared/libraries.js';
import { inspectGlobals } from './content/globals.js';
import { inspectScripts } from './content/scripts.js';
import { readSources } from './content/sources.js';
import { inspectBanners, addBanners } from './shared/banners.js';
import { mergeDetections, MAX_FRAMES } from './shared/detection.js';
import { assessAll } from './shared/vulnerabilities.js';
import { validateDatabase } from './shared/database.js';
import { pickHeaders, headersForDocument } from './shared/headers.js';

// A single, ephemeral selection. No history, persistent results, or localStorage.
// session survives MV3 worker suspension but is cleared on browser restart.
const KEY = 'inspection';
// Bounds for the opt-in file check, shared across all frames of one scan.
const MAX_SOURCE_FILES = 100;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_TOTAL = 24 * 1024 * 1024;
let queue = Promise.resolve();
let databasePromise;
function serial(task) {
  const result = queue.then(task);
  queue = result.catch(() => {});
  return result;
}
async function readSelection() { return (await chrome.storage.session.get(KEY))[KEY] || null; }
async function writeSelection(value) {
  if (value) await chrome.storage.session.set({ [KEY]: value });
  else { chrome.webRequest.onResponseStarted.removeListener(observeResponse); await chrome.storage.session.remove(KEY); }
}
async function fingerprint(value) {
  const url = new URL(value);
  url.hash = '';
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url.href)))].map(x => x.toString(16).padStart(2, '0')).join('');
}
// The popup passes the window it is attached to. Chrome can report that window
// as unfocused while its own popup is open (notably on macOS), so trust the
// popup's window at the start. Once a scan starts, windows.onFocusChanged
// cancels its ticket (and clears the selection) on real focus changes.
const tickets = new Set();
async function withTicket(windowId, task) {
  const ticket = { windowId, cancelled: false };
  tickets.add(ticket);
  try { return await task(ticket); } finally { tickets.delete(ticket); }
}
async function focusedTab(windowId) {
  const window = Number.isInteger(windowId) ? await chrome.windows.get(windowId) : await chrome.windows.getLastFocused();
  if (!Number.isInteger(windowId) && !window.focused) throw new Error('Focus a Chrome window and open rustline.dev on the page you want to inspect.');
  const [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
  if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) throw new Error('Open rustline.dev from a regular HTTP or HTTPS page. Chrome settings, the Web Store, files and extension pages cannot be inspected.');
  return tab;
}
async function stillFocused(tab, ticket) {
  if (ticket.cancelled) throw new Error('You switched windows during inspection. Open rustline.dev on the page again.');
  const current = await focusedTab(tab.windowId);
  if (current.id !== tab.id || current.windowId !== tab.windowId || current.url !== tab.url) throw new Error('The active page changed during inspection. Open rustline.dev on the page again.');
  return current;
}
async function select(tab) {
  return serial(async () => {
    const previous = await readSelection();
    const origin = new URL(tab.url).origin;
    registerHeaders(tab);
    if (previous?.tabId === tab.id && previous.origin === origin) return previous;
    const selection = { tabId: tab.id, windowId: tab.windowId, origin, enabledAt: Date.now(), headers: null };
    await writeSelection(selection);
    return selection;
  });
}
function database() {
  return databasePromise ||= fetch(chrome.runtime.getURL('data/vulnerabilities.json'))
    .then(response => { if (!response.ok) throw new Error('The bundled vulnerability database could not be loaded.'); return response.json(); })
    .then(validateDatabase).catch(error => { databasePromise = null; throw error; });
}

export function scanFocusedTab(windowId) { return withTicket(windowId, ticket => scan(windowId, ticket)); }
// Same scan, plus licence banners read from the site's own script files. Only
// ever started by the popup's explicit file-check button.
export function scanFiles(windowId) { return withTicket(windowId, ticket => scan(windowId, ticket, true)); }
async function scan(windowId, ticket, files = false) {
  const tab = await focusedTab(windowId);
  ticket.windowId = tab.windowId;
  await select(tab);
  await stillFocused(tab, ticket);
  let globals, scripts, discovered;
  try {
    // Cheap discovery only: no globals, script tags or page data are inspected.
    // Select a bounded, deterministic set BEFORE running the substantive probes.
    discovered = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'ISOLATED', func: () => null });
    await stillFocused(tab, ticket);
    const selected = discovered.filter(frame => frame.documentId).sort((a, b) => a.frameId - b.frameId).slice(0, MAX_FRAMES);
    if (!selected.some(frame => frame.frameId === 0)) throw new Error('No top document');
    const target = { tabId: tab.id, documentIds: selected.map(frame => frame.documentId) };
    [globals, scripts] = await Promise.all([
      chrome.scripting.executeScript({ target, world: 'MAIN', func: inspectGlobals, args: [LIBRARIES.map(({ id, globals }) => ({ id, globals }))] }),
      chrome.scripting.executeScript({ target, world: 'ISOLATED', func: inspectScripts })
    ]);
  } catch {
    if (ticket.cancelled) throw new Error('You switched windows during inspection. Open rustline.dev on the page again.');
    throw new Error('Chrome could not inspect this page. Open rustline.dev again to grant temporary access. Restricted Chrome pages cannot be scanned.');
  }
  await stillFocused(tab, ticket);
  const top = scripts.find(frame => frame.frameId === 0);
  const topGlobals = globals.find(frame => frame.frameId === 0);
  if (!topGlobals?.documentId || topGlobals.documentId !== top?.documentId || !top?.result) throw new Error('The page navigated during inspection. Scan it again.');
  // A subframe that navigated between the two probes is skipped, not mixed.
  const frames = scripts.filter(frame => frame.result && globals.some(g => g.frameId === frame.frameId && g.documentId === frame.documentId)).slice(0, MAX_FRAMES);
  const frameGlobals = frames.flatMap(frame => {
    const result = globals.find(g => g.frameId === frame.frameId).result;
    if (!Array.isArray(result)) return [];
    return frame.frameId === 0 ? result : result.map(item => ({ ...item, evidence: `${item.evidence} (frame ${frame.result.frame})` }));
  });
  const merged = mergeDetections(frameGlobals, frames.flatMap(frame => frame.result.urls));
  const db = await database();
  let rows = assessAll(merged.rows, db);
  let fileCheck = null;
  if (files) {
    const { banners, ...counts } = await readBanners(tab, frames, ticket);
    rows = addBanners(rows, banners, db);
    fileCheck = counts;
  }
  const state = await serial(readSelection);
  const headerValues = state?.tabId === tab.id && state.origin === new URL(tab.url).origin ? headersForDocument(state.headers, await fingerprint(tab.url), top.result.timeOrigin, top.result.responseEnd) : null;
  await stillFocused(tab, ticket);
  const [currentDocument] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, world: 'ISOLATED', func: () => null });
  if (currentDocument?.documentId !== top.documentId) throw new Error('The page reloaded during inspection. Scan it again.');
  await stillFocused(tab, ticket);
  return {
    host: new URL(tab.url).host,
    rows, files: fileCheck,
    headers: headerValues, generatedAt: db.generatedAt, scannedAt: new Date().toISOString(),
    frames: frames.length, framesSkipped: discovered.length > MAX_FRAMES,
    truncated: frames.some(frame => frame.result.truncated === true),
    unchecked: merged.unchecked
  };
}

// Frames run one at a time against a shared budget. Each body is dropped as
// soon as its comments are parsed; only banner findings and counts remain.
async function readBanners(tab, frames, ticket) {
  const banners = [];
  const seen = [];
  let read = 0, skipped = 0, budget = MAX_SOURCE_TOTAL;
  for (const frame of frames) {
    let result;
    try {
      [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id, documentIds: [frame.documentId] }, world: 'ISOLATED', func: readSources, args: [seen, MAX_SOURCE_FILES - seen.length, MAX_SOURCE_BYTES, budget] });
    } catch { /* A subframe that navigated away is skipped; the top document is rechecked by the caller. */ }
    await stillFocused(tab, ticket);
    if (!result) continue;
    seen.push(...result.seen);
    skipped += result.skipped;
    for (const file of result.files) {
      budget -= file.text.length;
      const inspected = inspectBanners(file.text, file.where);
      if (inspected.error) skipped++; else read++;
      banners.push(...inspected.banners);
    }
  }
  return { banners, read, skipped };
}

export function reloadForHeaders(windowId) { return withTicket(windowId, ticket => reload(windowId, ticket)); }
async function reload(windowId, ticket) {
  const tab = await focusedTab(windowId);
  ticket.windowId = tab.windowId;
  await select(tab);
  await stillFocused(tab, ticket);
  await chrome.tabs.reload(tab.id);
  return { reloading: true };
}

// Register only AFTER the click grants activeTab. Chrome rejects webRequest
// registration with no effective host grant. Filter at API level by tab and
// hostname, then recheck origin (including port) and focus before reading values.
function registerHeaders(tab) {
  chrome.webRequest.onResponseStarted.removeListener(observeResponse);
  const url = new URL(tab.url);
  chrome.webRequest.onResponseStarted.addListener(observeResponse, {
    tabId: tab.id, urls: [`${url.protocol}//${url.hostname}/*`], types: ['main_frame']
  }, ['responseHeaders']);
}
function observeResponse(details) {
  void serial(async () => {
    const state = await readSelection();
    if (!state || details.tabId !== state.tabId || details.timeStamp < state.enabledAt || new URL(details.url).origin !== state.origin) return;
    if (details.statusCode >= 300 && details.statusCode < 400) return;
    let tab;
    try { tab = await focusedTab(state.windowId); } catch { return; }
    if (tab.id !== state.tabId || tab.windowId !== state.windowId) return;
    const values = pickHeaders(details.responseHeaders);
    state.headers = { values, observedAt: details.timeStamp, urlHash: await fingerprint(details.url) };
    await writeSelection(state);
  }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!changeInfo.url && !changeInfo.status) return;
  void serial(async () => {
    const state = await readSelection();
    if (state?.tabId !== tabId) return;
    const tab = await chrome.tabs.get(tabId);
    // Once activeTab is revoked Chrome omits the URL from onUpdated AND get().
    // An absent URL is a reason to clear the selection, never to retain access.
    if (!tab.url || new URL(tab.url).origin !== state.origin) { await writeSelection(null); return; }
    if (state.headers && state.headers.urlHash !== await fingerprint(tab.url)) { state.headers = null; await writeSelection(state); }
    // Chrome can emit status=loading AFTER response headers have arrived.
    // Same-URL reloads are gated by document navigation timing during the scan,
    // rather than deleting the new response based on that reordered event.
  }).catch(() => {});
});
chrome.tabs.onActivated.addListener(info => {
  void serial(async () => { const state = await readSelection(); if (state && (state.tabId !== info.tabId || state.windowId !== info.windowId)) await writeSelection(null); }).catch(() => {});
});
// On Linux, Chrome reports WINDOW_ID_NONE when the extension's own popup takes
// focus, which is not the user leaving. Decide a moment later: a popup that is
// still open means the user is still here; leaving Chrome closes the popup.
// A later focus event supersedes the pending decision.
const FOCUS_SETTLE_MS = 300;
let focusEvents = 0;
async function popupOpen() { return (await chrome.runtime.getContexts({ contextTypes: ['POPUP'] })).length > 0; }
function focusMoved(windowId) {
  for (const ticket of tickets) if (ticket.windowId !== windowId) ticket.cancelled = true;
  void serial(async () => { const state = await readSelection(); if (state && state.windowId !== windowId) await writeSelection(null); }).catch(() => {});
}
chrome.windows.onFocusChanged.addListener(windowId => {
  const event = ++focusEvents;
  if (windowId !== chrome.windows.WINDOW_ID_NONE) { focusMoved(windowId); return; }
  setTimeout(() => {
    if (event !== focusEvents) return;
    popupOpen().then(open => { if (!open && event === focusEvents) focusMoved(windowId); }, () => focusMoved(windowId));
  }, FOCUS_SETTLE_MS);
});
chrome.tabs.onRemoved.addListener(tabId => {
  void serial(async () => { if ((await readSelection())?.tabId === tabId) await writeSelection(null); }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup/popup.html') || sender.tab) return false;
  const handler = message?.type === 'scan' ? scanFocusedTab : message?.type === 'scan-files' ? scanFiles : message?.type === 'reload-headers' ? reloadForHeaders : null;
  if (!handler) return false;
  handler(message.windowId).then(result => sendResponse({ ok: true, result }), error => sendResponse({ ok: false, error: error.message || 'Inspection failed.' }));
  return true;
});

// A popup message always wakes the worker and re-registers before a requested
// reload. Also restore passive observation when a session grant still exists.
// If a response races worker restoration, report headers unavailable; never
// substitute an older document's headers or issue a request to recover them.
void serial(async () => {
  const state = await readSelection();
  if (!state) return;
  let tab;
  try { tab = await focusedTab(state.windowId); } catch { await writeSelection(null); return; }
  if (tab.id === state.tabId && new URL(tab.url).origin === state.origin) registerHeaders(tab);
  else await writeSelection(null);
}).catch(() => {});
