import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readZip, writeZip } from '../src/archive/zip.js';

test('writes and reads ZIP archives without runtime dependencies', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'package-zip-'));
  const archive = path.join(directory, 'roundtrip.zip');
  try {
    await writeZip(
      archive,
      [
        {
          path: 'src/index.ts',
          data: Buffer.from('export const answer = 42;\n'),
          mode: 0o644,
        },
        {
          path: 'scripts/run.sh',
          data: Buffer.from('#!/bin/sh\necho ok\n'),
          mode: 0o755,
        },
      ],
      { deterministic: true, compressionLevel: 9 },
    );
    const entries = await readZip(archive);
    assert.equal(
      entries.get('src/index.ts')?.data.toString('utf8'),
      'export const answer = 42;\n',
    );
    assert.equal(entries.get('scripts/run.sh')?.mode, 0o755);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects unsafe ZIP paths while writing', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'package-zip-'));
  try {
    await assert.rejects(
      writeZip(path.join(directory, 'unsafe.zip'), [
        { path: '../outside.txt', data: Buffer.from('no') },
      ]),
      /Path escapes the project root/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects duplicate portable ZIP paths while writing', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'package-zip-'));
  try {
    await assert.rejects(
      writeZip(path.join(directory, 'duplicates.zip'), [
        { path: 'src/App.ts', data: Buffer.from('one') },
        { path: 'src/app.ts', data: Buffer.from('two') },
      ]),
      /Duplicate ZIP entry/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects disagreement between local and central ZIP headers', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'package-zip-'));
  const archive = path.join(directory, 'header-mismatch.zip');
  try {
    await writeZip(archive, [
      { path: 'index.txt', data: Buffer.from('content') },
    ]);
    const data = await readFile(archive);
    data[30] = 'X'.charCodeAt(0);
    await writeFile(archive, data);
    await assert.rejects(readZip(archive), /headers disagree/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects trailing data after the ZIP end record', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'package-zip-'));
  const archive = path.join(directory, 'trailing-data.zip');
  try {
    await writeZip(archive, [
      { path: 'index.txt', data: Buffer.from('content') },
    ]);
    const data = await readFile(archive);
    await writeFile(archive, Buffer.concat([data, Buffer.from('unexpected')]));
    await assert.rejects(readZip(archive), /trailing archive data/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
