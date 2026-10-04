import { compareVersions, inRange, parseVersion } from './versions.js';

export function assess(detection, database) {
  const library = database.libraries[detection.id];
  const base = { ...detection, latest: library?.latest ?? null, advisories: [], maintenance: [] };
  const unknown = reason => ({ ...base, status: 'unknown', reason });
  if (!detection.version || !parseVersion(detection.version)) return unknown('The library is present, but its exact version is unavailable.');
  if (!library || library.coverage !== 'retire') return unknown('This library has no coverage in the bundled advisory source.');
  let inconclusive = false;
  for (const advisory of library.advisories) {
    const matches = advisory.ranges.map(range => inRange(detection.version, range));
    if (matches.includes(true)) (advisory.kind === 'maintenance' ? base.maintenance : base.advisories).push(advisory);
    else if (matches.includes(null)) inconclusive = true;
  }
  if (base.advisories.length) return { ...base, status: 'vulnerable', reason: 'This version matches known advisories. Exposure depends on how the library is used.' };
  if (inconclusive) return unknown('An advisory range could not be compared reliably.');
  if (base.maintenance.length) return { ...base, status: 'outdated', reason: 'The upstream source marks this version as no longer maintained.' };
  if (!library.latest) return unknown('The bundled data has no stable release to compare against.');
  if (parseVersion(detection.version).prerelease.length) return unknown('This is a prerelease; no matching advisory was found, but stable-release status is inconclusive.');
  const comparison = compareVersions(detection.version, library.latest);
  if (comparison === null || comparison > 0) return unknown('This version is newer than, or cannot be compared with, the bundled release snapshot.');
  return { ...base, status: comparison < 0 ? 'outdated' : 'current', reason: comparison < 0 ? `A newer stable release (${library.latest}) is recorded. No advisory matched in this snapshot.` : 'Matches the stable release in this snapshot. No advisory matched; this is not a security guarantee.' };
}

export function assessAll(detections, database) {
  const order = { vulnerable: 0, outdated: 1, unknown: 2, current: 3 };
  return detections.map(item => assess(item, database)).sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name) || (a.version || '').localeCompare(b.version || ''));
}
