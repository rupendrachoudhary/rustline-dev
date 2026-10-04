import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync } from 'fflate';
import { validateDatabase } from '../extension/shared/database.js';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const directories = ['.github', 'extension', 'scripts', 'schema', 'tests', 'tools', 'demo'];
const documents = ['.gitignore', '.gitattributes', 'package.json', 'package-lock.json', 'README.md', 'TESTING.md', 'VALIDATION.md', 'CHANGELOG.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];
const ignored = new Set(['.DS_Store', 'node_modules', 'test-results', 'scan-reports', 'dist', '.git']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = bytes => JSON.parse(Buffer.from(bytes).toString('utf8'));

async function sourceFiles(root) {
  const files = new Map();
  async function add(relative) {
    const path = join(root, relative);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) throw new Error(`Release source must not contain symlinks: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) {
        if (!ignored.has(name) && !name.endsWith('.tmp')) await add(`${relative}/${name}`);
      }
    } else if (stat.isFile()) files.set(relative, await readFile(path));
  }
  for (const relative of [...documents, ...directories]) await add(relative);
  return new Map([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}

export async function releaseEntries(root = projectRoot) {
  const files = await sourceFiles(root);
  const pkg = json(files.get('package.json'));
  const manifest = json(files.get('extension/manifest.json'));
  const lock = json(files.get('package-lock.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'Release requires a numeric three-part version');
  assert.equal(manifest.version, pkg.version, 'Extension/package versions differ');
  assert.equal(lock.version, pkg.version, 'Lockfile version differs');
  assert.equal(lock.packages[''].version, pkg.version, 'Lockfile root version differs');
  assert.deepEqual(lock.packages[''].devDependencies, pkg.devDependencies, 'Lockfile dependencies differ');
  const database = validateDatabase(json(files.get('extension/data/vulnerabilities.json')));
  const hashes = [...files].map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256(bytes) }));
  const sourceSha256 = sha256(hashes.map(file => `${file.path}\0${file.sha256}\n`).join(''));
  const build = { format: 1, name: pkg.name, version: pkg.version, sourceSha256, databaseGeneratedAt: database.generatedAt, files: hashes };
  files.set('BUILD.json', Buffer.from(`${JSON.stringify(build, null, 2)}\n`));
  const entries = Object.fromEntries([...files].map(([path, bytes]) => [`rustline-dev/${path}`, bytes]));
  return { entries, build };
}

export function verifyArchive(bytes, expected) {
  const actual = unzipSync(bytes);
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), 'ZIP file list differs from source');
  for (const [path, body] of Object.entries(expected)) {
    assert.equal(sha256(actual[path]), sha256(body), `ZIP content differs: ${path}`);
  }
  return actual;
}

export async function buildRelease({ root = projectRoot, outDir = join(root, 'dist') } = {}) {
  const { entries, build } = await releaseEntries(root);
  // Fixed DOS date, file modes, compression and entry order make bytes repeatable.
  const archive = zipSync(entries, { level: 9, mtime: new Date(2000, 0, 1, 0, 0, 0), os: 3, attrs: 0o100644 << 16 });
  verifyArchive(archive, entries);
  const filename = `rustline-dev-${build.version}.zip`;
  const checksum = sha256(archive);
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, filename), archive);
  await writeFile(join(outDir, `${filename}.sha256`), `${checksum}  ${filename}\n`);
  return { archivePath: join(outDir, filename), checksum, build };
}

export async function verifyRelease(archivePath, root = projectRoot) {
  const expected = await releaseEntries(root);
  const path = archivePath || join(root, 'dist', `rustline-dev-${expected.build.version}.zip`);
  verifyArchive(await readFile(path), expected.entries);
  return expected.build;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--verify') {
      const build = await verifyRelease(process.argv[3]);
      console.log(`Verified ZIP against source: ${build.version} (${build.sourceSha256})`);
    } else {
      if (process.argv.length > 2) throw new Error('Usage: node scripts/release.mjs [--verify [ZIP]]');
      const release = await buildRelease();
      console.log(`Built and verified ${release.archivePath}\nSHA-256: ${release.checksum}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
