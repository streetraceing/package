import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readZip, writeZip } from '../src/archive/zip.js';

 test('writes and reads ZIP archives without runtime dependencies', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'package-zip-'));
  const archive = path.join(directory, 'roundtrip.zip');
  try {
    await writeZip(archive, [
      { path: 'src/index.ts', data: Buffer.from('export const answer = 42;\n'), mode: 0o644 },
      { path: 'scripts/run.sh', data: Buffer.from('#!/bin/sh\necho ok\n'), mode: 0o755 },
    ], { deterministic: true, compressionLevel: 9 });
    const entries = await readZip(archive);
    assert.equal(entries.get('src/index.ts')?.data.toString('utf8'), 'export const answer = 42;\n');
    assert.equal(entries.get('scripts/run.sh')?.mode, 0o755);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects unsafe ZIP paths while writing', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'package-zip-'));
  try {
    await assert.rejects(
      writeZip(path.join(directory, 'unsafe.zip'), [{ path: '../outside.txt', data: Buffer.from('no') }]),
      /Path escapes the project root/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
