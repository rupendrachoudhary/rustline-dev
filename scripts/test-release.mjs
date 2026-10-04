// Run the distributed source, including actual browser fixtures, after extraction.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';
import { unzipSync } from 'fflate';
import { buildRelease, verifyRelease } from './release.mjs';

const first = await buildRelease();
const second = await buildRelease();
assert.equal(first.checksum, second.checksum, 'Repeated builds must be byte-identical');
await verifyRelease(first.archivePath);
const temporary = await mkdtemp(join(tmpdir(), 'rustline-release-'));
async function run(command, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd') });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited ${code}`)));
  });
}
try {
  // Only unpack the verified archive generated above, with an extra path guard.
  for (const [path, bytes] of Object.entries(unzipSync(await readFile(first.archivePath)))) {
    assert.ok(path.startsWith('rustline-dev/') && !path.includes('..') && !path.includes('\\'));
    const destination = join(temporary, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  const extracted = join(temporary, 'rustline-dev');
  await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], extracted);
  for (const script of ['validate:data', 'test', 'test:browser', 'test:batch']) {
    await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', script], extracted);
  }
  console.log(`PASS extracted release ${first.build.version}; source ${first.build.sourceSha256}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
