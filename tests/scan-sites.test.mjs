import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUrlList, loadUrls } from '../tools/scan-sites.mjs';

test('URL list keeps fragments and ignores only comments', () => {
  const list = `# Pages to scan
  # indented comment
https://app.example/#/old
https://app.example/#/new
https://app.example/#/admin   # trailing note

https://app.example/page#section`;
  assert.deepEqual(parseUrlList(list), [
    'https://app.example/#/old',
    'https://app.example/#/new',
    'https://app.example/#/admin',
    'https://app.example/page#section'
  ]);
});

test('hash routes stay distinct after de-duplication', async () => {
  const urls = await loadUrls({ file: null, urls: ['https://app.example/#/old', 'https://app.example/#/new', 'https://app.example/#/old'] });
  assert.deepEqual(urls, ['https://app.example/#/old', 'https://app.example/#/new']);
});

test('batch report states every coverage limit that was reached', async () => {
  const { coverageWarnings } = await import('../tools/scan-sites.mjs');
  assert.deepEqual(coverageWarnings({ rows: [] }), []);
  const warnings = coverageWarnings({ rows: [], truncated: true, framesSkipped: true, unchecked: 1234, scriptsSkipped: 2 });
  assert.equal(warnings.length, 4);
  assert.ok(warnings[2].includes('1,234'));
});
