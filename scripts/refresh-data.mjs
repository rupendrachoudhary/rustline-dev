import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIBRARIES } from '../extension/shared/libraries.js';
import { validateDatabase } from '../extension/shared/database.js';
import { parseVersion } from '../extension/shared/versions.js';

export const SOURCE_URL = 'https://raw.githubusercontent.com/RetireJS/retire.js/master/repository/jsrepository-v4.json';
const root = fileURLToPath(new URL('../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');

function explain(summary, cwe) {
  const text = summary.toLowerCase();
  if (cwe.includes('CWE-1104') || /end.of.life|no longer (?:maintained|receiving)/i.test(summary)) return 'This release no longer receives security fixes. Future problems may remain unpatched.';
  if (cwe.includes('CWE-79') || /cross.site scripting|\bxss\b/.test(text)) return 'If untrusted content reaches the affected feature, an attacker may run JavaScript in a visitor’s browser and act as that visitor.';
  if (cwe.includes('CWE-1321') || /prototype pollution/.test(text)) return 'Crafted input may change shared JavaScript object properties, causing unexpected behavior or bypassing checks in code that uses them.';
  if (cwe.includes('CWE-1333') || /regular expression|redos/.test(text)) return 'Specially crafted input can take excessive time to process, potentially freezing a page or exhausting a service.';
  if (cwe.includes('CWE-918') || /server.side request forgery|\bssrf\b/.test(text)) return 'In affected server-side uses, an attacker may make the application send requests to unintended destinations, including private services.';
  if (/denial.of.service|resource exhaustion/.test(text) || cwe.some(x => ['CWE-400','CWE-770','CWE-674'].includes(x))) return 'Crafted input can consume excessive resources or crash the affected application. The impact depends on the feature and runtime used.';
  if (/code execution|code injection|\beval\(/.test(text) || cwe.some(x => ['CWE-94','CWE-95'].includes(x))) return 'If attacker-controlled input reaches the affected feature, it may be interpreted as code instead of ordinary data.';
  if (/path traversal/.test(text) || cwe.includes('CWE-22')) return 'In affected uses, crafted paths may access files or locations outside the intended directory.';
  return 'The upstream source reports a security issue affecting this version. Whether it can be exploited depends on how the affected feature handles untrusted input; check the advisory for details.';
}

export function transformRepository(raw, releases, { generatedAt = new Date().toISOString(), sourceHash = digest(JSON.stringify(raw)) } = {}) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.jquery?.vulnerabilities)) throw new Error('Unexpected Retire.js v4 repository format');
  const libraries = {};
  const severityRank = { unknown: 0, low: 1, medium: 2, high: 3, critical: 4 };
  for (const library of LIBRARIES) {
    const upstream = raw[library.retire];
    // Fail the refresh instead of silently dropping an expected library.
    if (!upstream || !Array.isArray(upstream.vulnerabilities)) throw new Error(`Missing upstream coverage: ${library.retire}`);
    const release = releases[library.npm];
    if (typeof release !== 'string' || !parseVersion(release, { partial: false }) || parseVersion(release).prerelease.length) throw new Error(`Invalid stable npm release for ${library.npm}`);
    const grouped = new Map();
    for (const item of upstream.vulnerabilities) {
      // The selected v4 format is a union of [atOrAbove, below) intervals.
      // Refuse new upstream semantics until the importer understands them.
      const supported = ['atOrAbove','below','severity','cwe','identifiers','info'];
      if (Object.keys(item).some(key => !supported.includes(key))) throw new Error(`Unsupported upstream fields for ${library.id}`);
      const identifiers = item.identifiers || {};
      if (typeof identifiers !== 'object' || Array.isArray(identifiers)) throw new Error(`Invalid identifiers for ${library.id}`);
      for (const [field, value] of [['CVE', identifiers.CVE], ['cwe', item.cwe], ['info', item.info]]) {
        if (value !== undefined && (!Array.isArray(value) || value.some(entry => typeof entry !== 'string'))) throw new Error(`Invalid upstream ${field} for ${library.id}`);
      }
      if (identifiers.summary !== undefined && typeof identifiers.summary !== 'string') throw new Error(`Invalid upstream summary for ${library.id}`);
      if (identifiers.githubID !== undefined && typeof identifiers.githubID !== 'string') throw new Error(`Invalid upstream githubID for ${library.id}`);
      const aliases = [...new Set([...(identifiers.CVE || []), ...[identifiers.githubID].flat().filter(Boolean)])];
      const references = [...new Set((item.info || []).filter(value => /^https?:\/\//.test(value)))];
      const summary = identifiers.summary || `Security advisory affecting ${library.name}; see the linked upstream reference.`;
      const cwe = item.cwe || [];
      const maintenance = cwe.includes('CWE-1104') || /end.of.life|no longer (?:maintained|receiving)/i.test(summary);
      // Distinct GHSAs can share CVE aliases; retain each one's own summary.
      const id = (typeof identifiers.githubID === 'string' ? identifiers.githubID : null) || aliases[0] || `RETIRE-${library.id}-${identifiers.retid || digest(JSON.stringify({ summary, references })).slice(0, 12)}`;
      const range = { introduced: item.atOrAbove ?? null, fixed: item.below ?? null };
      const severity = Object.hasOwn(severityRank, item.severity) ? item.severity : 'unknown';
      let advisory = grouped.get(id);
      if (!advisory) {
        advisory = { id, aliases, kind: maintenance ? 'maintenance' : 'vulnerability', severity, summary, why: explain(summary, cwe), cwe, applicability: /node\.?js|server.side|\bssrf\b/i.test(summary) ? 'server' : 'unspecified', references, ranges: [] };
        grouped.set(id, advisory);
      } else {
        advisory.aliases = [...new Set([...advisory.aliases, ...aliases])];
        advisory.references = [...new Set([...advisory.references, ...references])];
        advisory.cwe = [...new Set([...advisory.cwe, ...cwe])];
        if (severityRank[severity] > severityRank[advisory.severity]) advisory.severity = severity;
      }
      if (!advisory.ranges.some(r => r.introduced === range.introduced && r.fixed === range.fixed)) advisory.ranges.push(range);
    }
    libraries[library.id] = { name: library.name, npm: library.npm, upstreamKey: library.retire, coverage: 'retire', latest: release, releaseSource: `https://registry.npmjs.org/${library.npm}/latest`, advisories: [...grouped.values()] };
  }
  return validateDatabase({ schemaVersion: 1, generatedAt, source: { name: 'Retire.js', url: SOURCE_URL, sha256: sourceHash, license: 'Apache-2.0', notice: 'Filtered and normalized by rustline.dev; explanations added. Upstream advisory identifiers, ranges and references retained.' }, libraries });
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const body = await response.text();
  if (body.length > 8_000_000) throw new Error('Unexpectedly large upstream response');
  return body;
}

export async function main(args = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--retire-file','--releases-file','--out','--as-of'].includes(args[i]) || !args[i + 1]) throw new Error('Usage: node scripts/refresh-data.mjs [--retire-file FILE --releases-file FILE --as-of ISO_DATE] [--out FILE]');
    options[args[i]] = args[i + 1];
  }
  if ((options['--retire-file'] || options['--releases-file']) && !options['--as-of']) throw new Error('Offline inputs require --as-of with the oldest input snapshot date so stale data is not relabeled as fresh.');
  const asOf = options['--as-of'] || new Date().toISOString();
  if (!Number.isFinite(Date.parse(asOf)) || Date.parse(asOf) > Date.now()) throw new Error('Invalid/future --as-of date');
  const body = options['--retire-file'] ? await readFile(options['--retire-file'], 'utf8') : await download(SOURCE_URL);
  const releases = options['--releases-file'] ? JSON.parse(await readFile(options['--releases-file'], 'utf8')) : {};
  if (!options['--releases-file']) {
    // Bounded concurrency; only public package metadata, never browsing data.
    for (let i = 0; i < LIBRARIES.length; i += 3) {
      await Promise.all(LIBRARIES.slice(i, i + 3).map(async library => {
        const metadata = JSON.parse(await download(`https://registry.npmjs.org/${library.npm}/latest`));
        if (metadata.name !== library.npm) throw new Error('Unexpected npm package identity');
        releases[library.npm] = metadata.version;
      }));
    }
  }
  const database = transformRepository(JSON.parse(body), releases, { sourceHash: digest(body), generatedAt: new Date(asOf).toISOString() });
  const output = options['--out'] ? resolve(options['--out']) : resolve(root, 'extension/data/vulnerabilities.json');
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(database, null, 2)}\n`);
  await rename(temporary, output); // No partial database if a download/validation fails.
  console.log(`Updated ${output}: ${LIBRARIES.length} libraries, ${Object.values(database.libraries).reduce((n, l) => n + l.advisories.length, 0)} advisories.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
