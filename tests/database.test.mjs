import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LIBRARIES } from '../extension/shared/libraries.js';
import { assess } from '../extension/shared/vulnerabilities.js';
import { validateDatabase } from '../extension/shared/database.js';
import { transformRepository, main } from '../scripts/refresh-data.mjs';
import { pickHeaders, headersForDocument } from '../extension/shared/headers.js';
const db = JSON.parse(await readFile(new URL('../extension/data/vulnerabilities.json', import.meta.url)));
const row = (id, version) => assess({ id, version, evidence:[] }, db);

test('bundled data validates and vulnerable boundaries match real upstream CVEs', () => {
  validateDatabase(db);
  assert.ok(row('jquery', '3.4.0').advisories.some(a => a.aliases.includes('CVE-2020-11022')));
  assert.ok(!row('jquery', '3.5.0').advisories.some(a => a.aliases.includes('CVE-2020-11022')));
  assert.ok(row('lodash', '4.17.20').advisories.some(a => a.aliases.includes('CVE-2021-23337')));
  assert.ok(!row('lodash', '4.18.0').advisories.some(a => a.aliases.includes('CVE-2021-23337')));
});
test('unknown is preserved for missing, future and prerelease versions', () => {
  assert.equal(row('jquery', null).status, 'unknown');
  assert.equal(row('jquery', '999.0.0').status, 'unknown');
  assert.equal(row('d3', '7.9.0-beta.1').status, 'unknown');
  assert.equal(row('nonexistent', '1.0.0').status, 'unknown');
  assert.equal(row('d3', db.libraries.d3.latest).status, 'current');
  assert.equal(row('d3', '3.0.0').status, 'outdated');
});
test('end-of-life-only notices are outdated, not a fabricated CVE', () => {
  const fixture = structuredClone(db);
  fixture.libraries.jquery.advisories = [{ id:'EOL', kind:'maintenance', ranges:[{introduced:null,fixed:'3.0.0'}] }];
  assert.equal(assess({id:'jquery',version:'2.0.0'},fixture).status,'outdated');
});
test('importer merges disjoint intervals and refuses unsupported source semantics', () => {
  const raw = Object.fromEntries(LIBRARIES.map(l => [l.retire, {vulnerabilities:[]} ]));
  const releases = Object.fromEntries(LIBRARIES.map(l => [l.npm, '9.0.0']));
  raw.jquery.vulnerabilities = [
    {atOrAbove:'1.0.0',below:'1.2.0',identifiers:{CVE:['CVE-2020-1234'],summary:'XSS'}},
    {atOrAbove:'2.0.0',below:'2.2.0',identifiers:{CVE:['CVE-2020-1234'],summary:'XSS'}}
  ];
  const result = transformRepository(raw, releases);
  assert.equal(result.libraries.jquery.advisories.length, 1);
  assert.equal(assess({id:'jquery',version:'1.5.0'}, result).status, 'outdated');
  assert.equal(assess({id:'jquery',version:'2.0.0'}, result).status, 'vulnerable');
  raw.jquery.vulnerabilities[0].above = '0.0.0';
  assert.throws(() => transformRepository(raw,releases), /Unsupported/);
});
test('failed refresh leaves the previous database untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(),'rustline-data-'));
  try {
    const source = join(dir,'source.json'), releases = join(dir,'releases.json'), output = join(dir,'db.json');
    await writeFile(source, '{}'); await writeFile(releases, '{}'); await writeFile(output, 'original');
    await assert.rejects(main(['--retire-file',source,'--releases-file',releases,'--as-of','2026-01-01T00:00:00Z','--out',output]));
    assert.equal(await readFile(output,'utf8'),'original');
  } finally { await rm(dir, {recursive:true,force:true}); }
});
test('offline inputs cannot silently relabel an old snapshot as fresh', async () => {
  await assert.rejects(main(['--retire-file','unused.json']), /require --as-of/);
});
test('only curated headers survive, and old documents cannot reuse header results', () => {
  assert.deepEqual(pickHeaders([{name:'SERVER',value:'nginx'},{name:'Set-Cookie',value:'secret'},{name:'X-Powered-By',value:'Example\r\nInjected'}]), [{name:'Server',value:'nginx'},{name:'X-Powered-By',value:'Example  Injected'}]);
  const record = {urlHash:'abc',observedAt:100,values:[]};
  assert.deepEqual(headersForDocument(record,'abc',99,10),[]);
  assert.equal(headersForDocument(record,'abc',101,10),null);
  assert.equal(headersForDocument(record,'def',99,10),null);
  assert.equal(headersForDocument(record,'abc',1,5),null);
  assert.equal(headersForDocument(record,'abc',99,0),null);
});
