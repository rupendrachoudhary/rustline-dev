import { LIBRARIES } from './libraries.js';
import { parseVersion, compareVersions } from './versions.js';

export function validateDatabase(db) {
  const fail = message => { throw new Error(`Invalid vulnerability database: ${message}`); };
  if (!db || db.schemaVersion !== 1) fail('schema version');
  if (!Number.isFinite(Date.parse(db.generatedAt))) fail('generation date');
  if (db.source?.name !== 'Retire.js' || !/^[a-f\d]{64}$/.test(db.source.sha256)) fail('source provenance');
  if (!db.libraries || typeof db.libraries !== 'object') fail('libraries');
  for (const definition of LIBRARIES) {
    const library = db.libraries[definition.id];
    if (!library || library.name !== definition.name || library.npm !== definition.npm) fail(definition.id);
    if (!['retire', 'unavailable'].includes(library.coverage)) fail('coverage');
    const latest = library.latest === null ? null : parseVersion(library.latest, { partial: false });
    if (library.latest !== null && (!latest || latest.prerelease.length)) fail('latest stable version');
    if (!Array.isArray(library.advisories) || library.advisories.length > 1000) fail('advisories');
    const ids = new Set();
    for (const advisory of library.advisories) {
      if (typeof advisory.id !== 'string' || ids.has(advisory.id)) fail('advisory ID');
      ids.add(advisory.id);
      if (!['vulnerability', 'maintenance'].includes(advisory.kind)) fail('advisory kind');
      if (!['low','medium','high','critical','unknown'].includes(advisory.severity)) fail('severity');
      for (const field of ['summary','why']) if (typeof advisory[field] !== 'string' || !advisory[field].trim()) fail(field);
      for (const field of ['aliases','cwe','references']) if (!Array.isArray(advisory[field]) || advisory[field].some(x => typeof x !== 'string')) fail(field);
      if (advisory.references.some(ref => !/^https?:\/\//.test(ref))) fail('reference URL');
      if (!['unspecified','server'].includes(advisory.applicability)) fail('applicability');
      if (!Array.isArray(advisory.ranges) || !advisory.ranges.length) fail('ranges');
      for (const range of advisory.ranges) {
        if (!range || (range.introduced === null && range.fixed === null)) fail('unbounded range');
        for (const bound of ['introduced','fixed']) if (range[bound] !== null && !parseVersion(range[bound])) fail(`unsupported ${bound}: ${range[bound]}`);
        if (range.introduced && range.fixed && compareVersions(range.introduced, range.fixed) >= 0) fail('empty/reversed range');
      }
    }
  }
  return db;
}
