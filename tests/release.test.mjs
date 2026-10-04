import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, unzipSync } from 'fflate';
import { releaseEntries, verifyArchive } from '../scripts/release.mjs';

test('release includes locked tooling and current code, but no local runtime state', async () => {
  const { entries, build } = await releaseEntries();
  assert.ok(entries['rustline-dev/.github/workflows/ci.yml']);
  assert.ok(entries['rustline-dev/package-lock.json']);
  assert.ok(entries['rustline-dev/tools/banners.mjs']);
  assert.ok(entries['rustline-dev/BUILD.json']);
  assert.equal(Object.keys(entries).some(path => /\/(node_modules|test-results|scan-reports|dist)\//.test(path)), false);
  assert.equal(JSON.parse(Buffer.from(entries['rustline-dev/extension/manifest.json'])).version, build.version);
});

test('release verification rejects stale bytes and missing/extra entries', async () => {
  const { entries } = await releaseEntries();
  const packed = zipSync(entries);
  verifyArchive(packed, entries);
  const stale = unzipSync(packed);
  stale['rustline-dev/extension/background.js'] = new TextEncoder().encode('// old build');
  assert.throws(() => verifyArchive(zipSync(stale), entries), /ZIP content differs/);
  delete stale['rustline-dev/extension/background.js'];
  assert.throws(() => verifyArchive(zipSync(stale), entries), /ZIP file list differs/);
  assert.throws(() => verifyArchive(zipSync({ ...entries, 'rustline-dev/unexpected.txt': new Uint8Array() }), entries), /ZIP file list differs/);
});
