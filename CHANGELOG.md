# Changelog

## 0.2.1 — 2026-10-04

- Fix response headers never appearing on Linux: opening the popup made Chrome report “no window focused”, which cleared the selection and its captured headers. That signal is now acted on only once the popup has closed.
- Tests and the batch scanner send the popup's window id with each scan, as the popup does.

## 0.2.0 — 2026-10-04

- Add an opt-in file check to the popup: reads this site’s own (same-origin) script files and matches library licence banners, so self-hosted and bundled copies can be found. Never runs on its own; other origins are not requested; no new permission.
- Banner matching moves to `extension/shared/banners.js`, shared with the batch scanner. Acorn 8.18.0 is vendored unmodified in `extension/vendor/` for it.

## 0.1.1 — 2026-09-26

- Fix batch banner false positives from JavaScript strings, templates and regex literals by matching actual parsed comments. Unavailable or unparseable bodies are reported as incomplete coverage.
- Limit library/global and script-tag probes to 50 selected documents after lightweight frame discovery, with a visible coverage warning.
- Include the focus-cancellation, hash-route preservation and cross-frame aggregation fixes in the distributed release.
- Pin development dependencies in a lockfile and add CI for unit, browser, batch and extracted-release checks.
- Generate deterministic versioned ZIPs with BUILD.json source hashes and a SHA-256 sidecar; reject stale or incomplete archives.

## 0.1.0

Initial Chrome MV3 MVP, bundled Retire.js data, local demo, same-origin frame detection, and developer batch reports.
