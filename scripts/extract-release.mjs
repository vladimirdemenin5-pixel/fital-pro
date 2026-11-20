import { cp, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const archive = resolve('Fital_Pro_PRODUCTION_GITHUB_READY.zip');
const temp = await mkdtemp(join(tmpdir(), 'fital-pro-release-'));

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `${command} exited with code ${result.status}`);
  }
}

try {
  if (process.platform === 'win32') {
    const quote = value => value.replace(/'/g, "''");
    const command = `Expand-Archive -LiteralPath '${quote(archive)}' -DestinationPath '${quote(temp)}' -Force`;
    run('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]);
  } else {
    run('unzip', ['-o', archive, 'public/*', 'migrations/*', '-d', temp]);
  }

  await cp(join(temp, 'public'), resolve('public'), { recursive: true, force: true });
  await cp(join(temp, 'migrations'), resolve('migrations'), { recursive: true, force: true });
  process.stdout.write('Release assets and migrations extracted successfully.\n');
} finally {
  await rm(temp, { recursive: true, force: true });
}
