import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { createSnapshot } from '../src/commands/zip.js';
import { createShiftArchive } from '../src/commands/shift.js';
import { loadPackage } from '../src/manifest/load.js';
import { comparePackageToProject } from '../src/commands/compare.js';
import { applyPackage } from '../src/apply/transaction.js';

async function write(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

test('creates a snapshot, generates a shift archive, and applies it', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'package-integration-'));
  const source = path.join(workspace, 'source-project');
  const target = path.join(workspace, 'target-project');
  try {
    await mkdir(source, { recursive: true });
    await write(source, '.gitignore', 'secret.txt\n*.zip\n');
    await write(source, 'package.json', '{"name":"demo","version":"1.0.0"}\n');
    await write(source, 'src/old.ts', 'export const value = 1;\n');
    await write(source, 'src/remove.ts', 'remove me\n');
    await write(source, 'scripts/run.sh', '#!/bin/sh\necho old\n');
    await chmod(path.join(source, 'scripts/run.sh'), 0o644);
    await write(source, 'secret.txt', 'not in archives\n');
    await cp(source, target, { recursive: true });

    const config = {
      ...defaultConfig,
      root: source,
      output: workspace,
      strategy: 'walk' as const,
      gitignore: true,
      deterministic: true,
    };
    const baseArchive = await createSnapshot(config, {
      output: '../base.zip',
      quiet: true,
    });

    await rename(
      path.join(source, 'src/old.ts'),
      path.join(source, 'src/new.ts'),
    );
    await unlink(path.join(source, 'src/remove.ts'));
    await write(source, 'src/added.ts', 'export const added = true;\n');
    await write(source, 'package.json', '{"name":"demo","version":"2.0.0"}\n');
    await chmod(path.join(source, 'scripts/run.sh'), 0o755);

    const updateArchive = await createShiftArchive('../base.zip', config, {
      output: '../update.zip',
      quiet: true,
    });
    assert.equal(baseArchive, path.join(workspace, 'base.zip'));
    assert.equal(updateArchive, path.join(workspace, 'update.zip'));

    const pkg = await loadPackage(updateArchive);
    const before = await comparePackageToProject(pkg, target);
    assert.equal(before.baseMatches, true);
    assert.ok(before.changes.some((change) => change.kind === 'MOVE'));
    assert.ok(before.changes.some((change) => change.kind === 'REMOVE'));
    assert.ok(before.changes.some((change) => change.kind === 'ADD'));
    assert.ok(before.changes.some((change) => change.kind === 'MODIFY'));

    await applyPackage(pkg, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'abort',
    });

    assert.equal(
      await readFile(path.join(target, 'src/new.ts'), 'utf8'),
      'export const value = 1;\n',
    );
    assert.equal(
      await readFile(path.join(target, 'src/added.ts'), 'utf8'),
      'export const added = true;\n',
    );
    assert.equal(
      await readFile(path.join(target, 'package.json'), 'utf8'),
      '{"name":"demo","version":"2.0.0"}\n',
    );
    await assert.rejects(readFile(path.join(target, 'src/old.ts')), /ENOENT/);
    await assert.rejects(
      readFile(path.join(target, 'src/remove.ts')),
      /ENOENT/,
    );

    const after = await comparePackageToProject(pkg, target);
    assert.equal(
      after.changes.filter((change) => change.kind !== 'UNCHANGED').length,
      0,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('snapshot reserves manifest files and embeds the configured shift metadata', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'package-metadata-'));
  const source = path.join(workspace, 'source-project');
  try {
    await mkdir(source, { recursive: true });
    await write(source, 'src/index.ts', 'export const value = 1;\n');
    await write(source, '.packagemanifest.json', '{"stale":true}\n');
    await write(source, '.packagemanifest', 'legacy manifest\n');
    await write(
      source,
      '.packageshift',
      'PACKAGESHIFT 1\n\nMESSAGE "Included snapshot instructions"\n',
    );

    const archivePath = await createSnapshot(
      {
        ...defaultConfig,
        root: source,
        output: workspace,
        strategy: 'walk',
        include: ['src/**'],
        ignore: ['.packageshift'],
        dot: false,
      },
      { output: '../snapshot.zip', quiet: true },
    );

    const pkg = await loadPackage(archivePath);
    assert.deepEqual(
      pkg.manifest.files.map((file) => file.path),
      ['src/index.ts'],
    );
    assert.equal(pkg.entries.has('.packagemanifest.json'), true);
    assert.equal(pkg.entries.has('.packagemanifest'), false);
    assert.equal(pkg.entries.has('.packageshift'), true);
    assert.equal(pkg.shift?.instructions[0]?.type, 'MESSAGE');
    assert.equal(
      pkg.shift?.instructions[0]?.type === 'MESSAGE'
        ? pkg.shift.instructions[0].value
        : undefined,
      'Included snapshot instructions',
    );

    const generatedManifest = JSON.parse(
      pkg.entries.get('.packagemanifest.json')?.data.toString('utf8') ?? '{}',
    ) as Record<string, unknown>;
    assert.equal(generatedManifest.schemaVersion, 1);
    assert.equal(generatedManifest.stale, undefined);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('snapshot validates .packageshift before writing the archive', async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), 'package-shift-invalid-'),
  );
  const source = path.join(workspace, 'source-project');
  try {
    await mkdir(source, { recursive: true });
    await write(source, 'src/index.ts', 'export const value = 1;\n');
    await write(source, '.packageshift', 'REMOVE "src/index.ts"\n');

    await assert.rejects(
      createSnapshot(
        {
          ...defaultConfig,
          root: source,
          output: workspace,
          strategy: 'walk',
        },
        { output: '../snapshot.zip', quiet: true },
      ),
      /first instruction must declare the format version/i,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
