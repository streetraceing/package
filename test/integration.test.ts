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
import { writeZip } from '../src/archive/zip.js';
import { sha256Buffer, stableJson } from '../src/util/hash.js';
import type { ManifestFile, PackageManifest } from '../src/types.js';

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

test('accepts a manifestless .packageshift archive for check, diff, and apply', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'package-manifestless-'));
  const target = path.join(workspace, 'target-project');
  const archivePath = path.join(workspace, 'update.zip');
  try {
    await mkdir(target, { recursive: true });
    await write(target, 'src/remove.ts', 'remove me\n');
    await write(target, 'src/keep.ts', 'old\n');

    await writeZip(
      archivePath,
      [
        {
          path: 'src/keep.ts',
          data: Buffer.from('new\n', 'utf8'),
          mode: 0o644,
        },
        {
          path: '.packageshift',
          data: Buffer.from(
            'PACKAGESHIFT 1\n\nREMOVE "src/remove.ts"\n',
            'utf8',
          ),
          mode: 0o644,
        },
      ],
      { compressionLevel: 9, deterministic: true },
    );

    const pkg = await loadPackage(archivePath);
    assert.equal(pkg.manifestSource, 'generated');
    assert.equal(pkg.manifest.kind, 'patch');
    assert.deepEqual(
      pkg.manifest.files.map((file) => file.path),
      ['src/keep.ts'],
    );
    assert.equal(pkg.shift?.instructions[0]?.type, 'REMOVE');

    const before = await comparePackageToProject(pkg, target);
    assert.ok(before.changes.some((change) => change.kind === 'MODIFY'));
    assert.ok(before.changes.some((change) => change.kind === 'REMOVE'));

    await applyPackage(pkg, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'abort',
    });

    assert.equal(
      await readFile(path.join(target, 'src/keep.ts'), 'utf8'),
      'new\n',
    );
    await assert.rejects(
      readFile(path.join(target, 'src/remove.ts')),
      /ENOENT/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('accepts legacy .packagemanifest metadata', async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), 'package-legacy-manifest-'),
  );
  const archivePath = path.join(workspace, 'legacy.zip');
  try {
    const data = Buffer.from('legacy payload\n', 'utf8');
    const files: ManifestFile[] = [
      {
        path: 'src/index.ts',
        size: data.length,
        mode: 0o644,
        sha256: sha256Buffer(data),
      },
    ];
    const manifest: PackageManifest = {
      schemaVersion: 1,
      kind: 'patch',
      project: 'legacy',
      createdAt: new Date(0).toISOString(),
      rootHash: sha256Buffer(Buffer.from(stableJson(files), 'utf8')),
      config: {
        strategy: 'walk',
        gitignore: false,
        npmignore: false,
        dot: true,
      },
      files,
    };

    await writeZip(
      archivePath,
      [
        { path: 'src/index.ts', data, mode: 0o644 },
        {
          path: '.packagemanifest',
          data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
          mode: 0o644,
        },
      ],
      { compressionLevel: 9, deterministic: true },
    );

    const pkg = await loadPackage(archivePath);
    assert.equal(pkg.manifestSource, 'legacy');
    assert.equal(pkg.manifest.files[0]?.path, 'src/index.ts');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('applies .packageshift hash conflicts according to conflict strategy', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'package-conflicts-'));
  const target = path.join(workspace, 'target-project');
  const archivePath = path.join(workspace, 'update.zip');
  const baseConfig = Buffer.from('{"version":1}\n', 'utf8');
  const localConfig = '{"version":"local"}\n';
  const archiveConfig = Buffer.from('{"version":2}\n', 'utf8');
  const oldSource = Buffer.from('old\n', 'utf8');
  const newSource = Buffer.from('new\n', 'utf8');
  try {
    await mkdir(target, { recursive: true });
    await write(target, '.packagerc', localConfig);
    await write(target, 'src/index.ts', oldSource.toString('utf8'));

    await writeZip(
      archivePath,
      [
        { path: '.packagerc', data: archiveConfig, mode: 0o644 },
        { path: 'src/index.ts', data: newSource, mode: 0o644 },
        {
          path: '.packageshift',
          data: Buffer.from(
            [
              'PACKAGESHIFT 1',
              '',
              `REPLACE ".packagerc" IF ${sha256Buffer(baseConfig)}`,
              `REPLACE "src/index.ts" IF ${sha256Buffer(oldSource)}`,
              '',
            ].join('\n'),
            'utf8',
          ),
          mode: 0o644,
        },
      ],
      { compressionLevel: 9, deterministic: true },
    );

    const pkg = await loadPackage(archivePath);
    const comparison = await comparePackageToProject(pkg, target);
    assert.ok(
      comparison.changes.some(
        (change) => change.kind === 'CONFLICT' && change.path === '.packagerc',
      ),
    );

    await assert.rejects(
      applyPackage(pkg, {
        cwd: target,
        dryRun: false,
        yes: true,
        force: false,
        backup: false,
        conflictStrategy: 'abort',
      }),
      /--conflict overwrite/,
    );
    assert.equal(
      await readFile(path.join(target, '.packagerc'), 'utf8'),
      localConfig,
    );
    assert.equal(
      await readFile(path.join(target, 'src/index.ts'), 'utf8'),
      'old\n',
    );

    const overwritten = await applyPackage(pkg, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'overwrite',
    });
    assert.deepEqual(overwritten.overwrittenConflicts, ['.packagerc']);
    assert.equal(
      await readFile(path.join(target, '.packagerc'), 'utf8'),
      '{"version":2}\n',
    );
    assert.equal(
      await readFile(path.join(target, 'src/index.ts'), 'utf8'),
      'new\n',
    );

    await write(target, '.packagerc', localConfig);
    await write(target, 'src/index.ts', 'old\n');
    const skipped = await applyPackage(pkg, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'skip',
    });
    assert.deepEqual(skipped.skippedPaths, ['.packagerc']);
    assert.equal(
      await readFile(path.join(target, '.packagerc'), 'utf8'),
      localConfig,
    );
    assert.equal(
      await readFile(path.join(target, 'src/index.ts'), 'utf8'),
      'new\n',
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
