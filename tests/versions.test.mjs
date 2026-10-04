import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, compareVersions, exactVersion, inRange } from '../extension/shared/versions.js';

test('numeric order avoids lexicographic mistakes', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('4.17.21', '4.17.21+build.42'), 0);
  assert.equal(compareVersions('1.999', '2.0.0'), -1);
});
test('SemVer prerelease precedence and legacy Retire bounds', () => {
  const order = ['1.0.0-alpha','1.0.0-alpha.1','1.0.0-alpha.beta','1.0.0-beta','1.0.0-beta.2','1.0.0-beta.11','1.0.0-rc.1','1.0.0'];
  for (let i = 1; i < order.length; i++) assert.equal(compareVersions(order[i-1], order[i]), -1);
  assert.equal(compareVersions('1.9.0b1', '1.9.0-beta.1'), 0);
  assert.equal(compareVersions('1.0.0.beta.3', '1.0.0-beta.3'), 0);
  assert.equal(compareVersions('1.0.0-beta1', '1.0.0-beta.1'), 1);
});
test('aliases, partial URLs and malformed versions stay unknown', () => {
  for (const value of ['latest','^3.0.0','~3.0.0','3.x','03.0.0','1.2.3.4','1.2.3banana','1.0.0-01','1.0.0-','1.0.0+','1.0.0+foo+bar','<script>']) assert.equal(parseVersion(value), null, value);
  for (const value of ['3','3.1', null, 3]) assert.equal(exactVersion(value), null);
  assert.equal(exactVersion('v3.1.2'), '3.1.2');
});
test('introduced inclusive, fixed exclusive, no fabricated comparisons', () => {
  const range = { introduced: '3.0.0', fixed: '3.5.0' };
  assert.equal(inRange('2.9.9', range), false);
  assert.equal(inRange('3.0.0', range), true);
  assert.equal(inRange('3.5.0', range), false);
  assert.equal(inRange('3.5.0-beta.1', range), true);
  assert.equal(inRange('3.5.0', { introduced: null, fixed: 'latest' }), null);
  assert.equal(inRange('3.5.0', { introduced: null, fixed: null }), null);
});
