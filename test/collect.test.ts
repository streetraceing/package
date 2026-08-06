import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createDefaultConfig, resolveConfigPaths } from '../src/config.js';
import { collectFiles } from '../src/files/collect.js';

test('walk collection rejects symbolic-link directory cycles', async (t) => {
  if (process.platform === 'win32') {
    t.skip(
      'directory symlink creation is not reliably available on Windows CI',
    );
    return;
  }
  const root = await mkdtemp(path.join(tmpdir(), 'package-symlink-cycle-'));
  try {
    await writeFile(path.join(root, 'index.txt'), 'content\n', 'utf8');
    await symlink(root, path.join(root, 'loop'), 'dir');
    const config = resolveConfigPaths(
      {
        ...createDefaultConfig(),
        strategy: 'walk',
        gitignore: false,
        followSymlinks: true,
      },
      root,
    );
    await assert.rejects(
      collectFiles(config),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('Symbolic link creates a directory cycle'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
