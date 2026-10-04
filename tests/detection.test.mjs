import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { LIBRARIES } from '../extension/shared/libraries.js';
import { inspectGlobals } from '../extension/content/globals.js';
import { inspectScripts } from '../extension/content/scripts.js';
import { detectScript, mergeDetections } from '../extension/shared/detection.js';

const inspect = window => vm.runInNewContext(`(${inspectGlobals.toString()})(definitions)`, { window, definitions: LIBRARIES });
test('all 15 libraries have working CDN identifiers', () => {
  for (const library of LIBRARIES) {
    for (const base of ['https://cdn.jsdelivr.net/npm/', 'https://unpkg.com/']) {
      const found = detectScript(`${base}${library.npm}@1.2.3/dist/library.min.js`);
      assert.equal(found.id, library.id); assert.equal(found.version, '1.2.3');
    }
    assert.equal(detectScript(`https://cdnjs.cloudflare.com/ajax/libs/${library.cdn[0]}/1.2.3/library.min.js`).id, library.id);
  }
  assert.equal(detectScript('https://ajax.googleapis.com/ajax/libs/angularjs/1.8.2/angular.min.js'), null);
  assert.equal(detectScript('https://ajax.googleapis.com/ajax/libs/angular/1.8.2/angular.min.js').id, 'angularjs');
});
test('CDN detection resists host/package confusion and does not guess aliases', () => {
  for (const url of ['https://cdn.jsdelivr.net.evil.test/npm/jquery@3.4.0/jquery.js','https://example.org/cdn.jsdelivr.net/npm/jquery@3.4.0/jquery.js','https://unpkg.com/jquery-plugin@1.2.3/x.js','https://cdnjs.cloudflare.com/ajax/libs/jquery/3.4.0/jquery.css']) assert.equal(detectScript(url), null);
  for (const version of ['latest','3','3.5','%5E3.5.0','%7E3.5.0']) assert.equal(detectScript(`https://unpkg.com/jquery@${version}/dist/jquery.js`).version, null);
  assert.equal(detectScript('https://unpkg.com/jquery').version, null);
});
test('version globals for 13 libraries, plus Lodash/Underscore disambiguation', () => {
  for (const library of LIBRARIES.filter(l => l.globals.length)) {
    const window = {}; let branch = window; const path = library.globals[0];
    for (const key of path.slice(0, -1)) branch = branch[key] = {};
    branch[path.at(-1)] = '1.2.3';
    assert.equal(inspect(window).find(row => row.id === library.id).version, '1.2.3');
  }
  assert.equal(inspect({ _: { VERSION:'4.17.21', runInContext(){} } })[0].id, 'lodash');
  assert.equal(inspect({ _: { VERSION:'1.13.0', template(){}, uniqueId(){} } })[0].id, 'underscore');
  assert.equal(inspect({ _: { VERSION:'1.0.0' } }).length, 0);
});
test('inspection skips getters, detects versionless presence and tolerates hostile globals', () => {
  const window = { axios: { get() {} }, React: new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('hostile'); } }) };
  Object.defineProperty(window, 'jQuery', { get() { throw new Error('must not run'); } });
  const rows = inspect(window);
  assert.equal(rows.length, 1); assert.equal(rows[0].id, 'axios'); assert.equal(rows[0].version, null);
});
test('different versions and unresolved aliases remain distinct; matching evidence deduplicates', () => {
  const { rows } = mergeDetections([{ id:'jquery', version:'3.4.0', evidence:'jQuery.fn.jquery' }], [
    'https://unpkg.com/jquery@3.4.0/dist/jquery.js', 'https://unpkg.com/jquery@3.5.0/dist/jquery.js', 'https://unpkg.com/jquery@latest/dist/jquery.js'
  ]);
  assert.equal(rows.length, 3); assert.equal(rows[0].evidence.length, 2);
});
test('script inspection strips query tokens and does not fetch scripts', () => {
  const result = vm.runInNewContext(`(${inspectScripts.toString()})()`, { URL, location:{pathname:'/phps/main1.php',search:'?session=secret'}, performance:{timeOrigin:123,getEntriesByType:()=>[{responseEnd:10}]}, document:{baseURI:'https://example.org', scripts:[{src:'https://unpkg.com/jquery@3.4.0/x.js?token=secret#fragment'}, {src:'data:application/javascript,alert(1)'}, {type:'application/json',src:'https://unpkg.com/react@1.0.0/data.js'}]} });
  assert.equal(result.urls.length, 1); assert.equal(result.urls[0], 'https://unpkg.com/jquery@3.4.0/x.js');
  assert.equal(result.frame, '/phps/main1.php');
});
test('custom jQuery builds resolve their leading version; unreadable versions keep the raw text', () => {
  const slim = '3.5.1 -ajax,-ajax/jsonp,-ajax/load,-ajax/script,-ajax/var/location,-ajax/var/nonce,-aj';
  const { rows: [row] } = mergeDetections([{ id:'jquery', version: slim, evidence:'jQuery.fn.jquery' }], []);
  assert.equal(row.version, '3.5.1');
  assert.equal(row.evidence[0].detail, 'jQuery.fn.jquery (custom build)');
  for (const odd of ['3.5.1 custom', '3.5 -ajax', 'banana -ajax', '3.5.1-ajax,-effects']) {
    const { rows: [unknown] } = mergeDetections([{ id:'jquery', version: odd, evidence:'jQuery.fn.jquery' }], []);
    assert.equal(unknown.version, null, odd);
    assert.ok(unknown.evidence[0].detail.includes(`reported "${odd}"`), odd);
  }
});
test('frame aggregation keeps every frame and reports anything it could not check', () => {
  // Six frames of 2,000 tags each, a detectable library last in every frame.
  const libraries = ['jquery@3.4.0', 'vue@2.6.14', 'axios@0.21.1', 'moment@2.29.4', 'd3@7.8.5', 'dompurify@2.0.8'];
  const urls = libraries.flatMap((library, frame) => [
    ...Array.from({ length: 1999 }, (_, i) => `https://site.example/f${frame}/s${i}.js`), `https://unpkg.com/${library}/x.js`
  ]);
  const six = mergeDetections([], urls);
  assert.deepEqual(six.rows.map(r => `${r.id}@${r.version}`).sort(), [...libraries].sort());
  assert.equal(six.unchecked, 0);
  // The maximum honest input (50 frames x 2,000 tags) is still fully checked.
  const full = mergeDetections([], Array.from({ length: 100000 }, (_, i) => `https://site.example/s${i}.js`));
  assert.equal(full.unchecked, 0);
  // So is the maximum globals input (50 frames x 100 results).
  assert.equal(mergeDetections(Array.from({ length: 5000 }, () => ({ id: 'jquery', version: '3.4.0', evidence: 'jQuery.fn.jquery' })), []).unchecked, 0);
  // Beyond the bounds the overflow is counted, never dropped silently.
  const over = mergeDetections(Array.from({ length: 5003 }, () => ({ id: 'jquery', version: '3.4.0', evidence: 'jQuery.fn.jquery' })), Array.from({ length: 100010 }, (_, i) => `https://site.example/s${i}.js`));
  assert.equal(over.unchecked, 13);
  // Repeated scripts across frames count once.
  assert.equal(mergeDetections([], Array(20000).fill('https://unpkg.com/vue@2.6.14/x.js')).unchecked, 0);
});
