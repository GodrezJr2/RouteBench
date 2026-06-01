import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dirs = ['src', 'test'];
const files = [];
for (const dir of dirs) {
  const entries = await readdir(dir);
  for (const entry of entries) {
    if (entry.endsWith('.js')) files.push(join(dir, entry));
  }
}

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
