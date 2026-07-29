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
import { applyCommand } from '../src/commands/apply.js';
import { writeZip } from '../src/archive/zip.js';
import { sha256Buffer, stableJson } from '../src/util/hash.js';
import {
  listBackupVersions,
  projectBackupDirectory,
  restoreBackupVersion,
} from '../src/apply/backups.js';
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

test('runs beforePackage and afterPackage hooks for zip and shift', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'package-hooks-'));
  const source = path.join(workspace, 'source-project');
  try {
    await mkdir(source, { recursive: true });
    await write(source, 'src/index.ts', 'export const value = 1;\n');
    await write(
      source,
      'scripts/hook.cjs',
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        'const phase = process.argv[2];',
        'const file = path.join(process.cwd(), `hook-${phase}-${process.env.PACKAGE_COMMAND}.json`);',
        "fs.writeFileSync(file, JSON.stringify({ hook: process.env.PACKAGE_HOOK, command: process.env.PACKAGE_COMMAND, root: process.env.PACKAGE_ROOT, archive: process.env.PACKAGE_ARCHIVE }) + '\\n');",
        '',
      ].join('\n'),
    );

    const config = {
      ...defaultConfig,
      root: source,
      output: workspace,
      strategy: 'walk' as const,
      beforePackage: ['node scripts/hook.cjs before'],
      afterPackage: ['node scripts/hook.cjs after'],
    };
    const baseArchive = await createSnapshot(config, {
      output: '../hooks-base.zip',
      quiet: true,
    });
    const base = await loadPackage(baseArchive);
    assert.ok(
      base.manifest.files.some((file) => file.path === 'hook-before-zip.json'),
    );
    assert.ok(
      !base.manifest.files.some((file) => file.path === 'hook-after-zip.json'),
    );
    const afterZip = JSON.parse(
      await readFile(path.join(source, 'hook-after-zip.json'), 'utf8'),
    ) as Record<string, string>;
    assert.equal(afterZip.hook, 'afterPackage');
    assert.equal(afterZip.command, 'zip');
    assert.equal(afterZip.archive, baseArchive);

    await write(source, 'src/index.ts', 'export const value = 2;\n');
    const shiftArchive = await createShiftArchive('../hooks-base.zip', config, {
      output: '../hooks-shift.zip',
      quiet: true,
    });
    const shift = await loadPackage(shiftArchive);
    assert.ok(
      shift.manifest.files.some(
        (file) => file.path === 'hook-before-shift.json',
      ),
    );
    const afterShift = JSON.parse(
      await readFile(path.join(source, 'hook-after-shift.json'), 'utf8'),
    ) as Record<string, string>;
    assert.equal(afterShift.hook, 'afterPackage');
    assert.equal(afterShift.command, 'shift');
    assert.equal(afterShift.archive, shiftArchive);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deletes the source archive only after successful non-dry-run apply', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'package-delete-apply-'));
  const source = path.join(workspace, 'source-project');
  const target = path.join(workspace, 'target-project');
  try {
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await write(source, 'src/index.ts', 'export const value = 1;\n');
    const config = {
      ...defaultConfig,
      root: source,
      output: workspace,
      strategy: 'walk' as const,
    };

    const dryRunArchive = await createSnapshot(config, {
      output: '../dry-run.zip',
      quiet: true,
    });
    await applyCommand(dryRunArchive, {
      cwd: target,
      dryRun: true,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'abort',
      deletePackageOnApply: true,
    });
    assert.ok((await readFile(dryRunArchive)).length > 0);

    const applyArchive = await createSnapshot(config, {
      output: '../delete-after-apply.zip',
      quiet: true,
    });
    await applyCommand(applyArchive, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'abort',
      deletePackageOnApply: true,
    });
    assert.equal(
      await readFile(path.join(target, 'src/index.ts'), 'utf8'),
      'export const value = 1;\n',
    );
    await assert.rejects(readFile(applyArchive), /ENOENT/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('runs beforeApply and afterApply around successful apply', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'package-apply-hooks-'));
  const source = path.join(workspace, 'source-project');
  const target = path.join(workspace, 'target-project');
  try {
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await write(source, 'src/index.ts', 'export const value = "new";\n');
    await write(target, 'src/index.ts', 'export const value = "old";\n');
    await write(
      target,
      'scripts/apply-hook.cjs',
      [
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        "const source = path.join(process.cwd(), 'src/index.ts');",
        "const log = path.join(process.cwd(), 'apply-hooks.jsonl');",
        'const entry = {',
        '  hook: process.env.PACKAGE_HOOK,',
        '  command: process.env.PACKAGE_COMMAND,',
        '  root: process.env.PACKAGE_ROOT,',
        '  archive: process.env.PACKAGE_ARCHIVE,',
        '  archiveExists: fs.existsSync(process.env.PACKAGE_ARCHIVE),',
        "  content: fs.readFileSync(source, 'utf8'),",
        '};',
        "fs.appendFileSync(log, JSON.stringify(entry) + '\\n');",
        '',
      ].join('\n'),
    );

    const config = {
      ...defaultConfig,
      root: source,
      output: workspace,
      strategy: 'walk' as const,
    };
    const archive = await createSnapshot(config, {
      output: '../apply-hooks.zip',
      quiet: true,
    });
    const hookScripts = ['node scripts/apply-hook.cjs'];

    await applyCommand(archive, {
      cwd: target,
      dryRun: true,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'overwrite',
      beforeApply: hookScripts,
      afterApply: hookScripts,
      deletePackageOnApply: false,
    });
    await assert.rejects(
      readFile(path.join(target, 'apply-hooks.jsonl'), 'utf8'),
      /ENOENT/,
    );

    await applyCommand(archive, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'overwrite',
      beforeApply: hookScripts,
      afterApply: hookScripts,
      deletePackageOnApply: true,
    });

    const entries = (
      await readFile(path.join(target, 'apply-hooks.jsonl'), 'utf8')
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries.map((entry) => entry.hook),
      ['beforeApply', 'afterApply'],
    );
    assert.ok(entries.every((entry) => entry.command === 'apply'));
    assert.equal(entries[0]?.content, 'export const value = "old";\n');
    assert.equal(entries[1]?.content, 'export const value = "new";\n');
    assert.ok(entries.every((entry) => entry.archiveExists === true));
    await assert.rejects(readFile(archive), /ENOENT/);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('keeps apply successful when afterApply scripts fail', async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), 'package-after-apply-warning-'),
  );
  const source = path.join(workspace, 'source-project');
  const target = path.join(workspace, 'target-project');
  const warnings: string[] = [];
  const originalWarn = console.warn;
  try {
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await write(source, 'src/index.ts', 'export const value = "new";\n');
    await write(target, 'src/index.ts', 'export const value = "old";\n');
    await write(
      target,
      'scripts/fail-after-apply.cjs',
      'process.exitCode = 7;\n',
    );
    await write(
      target,
      'scripts/log-after-apply.cjs',
      "require('node:fs').writeFileSync('after-apply-continued.txt', 'yes\\n');\n",
    );

    const archive = await createSnapshot(
      {
        ...defaultConfig,
        root: source,
        output: workspace,
        strategy: 'walk' as const,
      },
      { output: '../after-apply-warning.zip', quiet: true },
    );

    console.warn = (...args: unknown[]) => {
      warnings.push(args.map(String).join(' '));
    };
    await applyCommand(archive, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'overwrite',
      afterApply: [
        'node scripts/fail-after-apply.cjs',
        'node scripts/log-after-apply.cjs',
      ],
      deletePackageOnApply: true,
    });

    assert.equal(
      await readFile(path.join(target, 'src/index.ts'), 'utf8'),
      'export const value = "new";\n',
    );
    assert.equal(
      await readFile(path.join(target, 'after-apply-continued.txt'), 'utf8'),
      'yes\n',
    );
    await assert.rejects(readFile(archive), /ENOENT/);
    assert.ok(
      warnings.some((message) =>
        message.includes('afterApply script failed (exit code 7)'),
      ),
    );
    assert.ok(
      warnings.some((message) =>
        message.includes(
          'Project changes remain applied and cleanup continues',
        ),
      ),
    );
  } finally {
    console.warn = originalWarn;
    await rm(workspace, { recursive: true, force: true });
  }
});

test('deletes only the exact source snapshot referenced by a shift archive', async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), 'package-source-cleanup-'),
  );
  const source = path.join(workspace, 'source-project');
  const target = path.join(workspace, 'target-project');
  try {
    await mkdir(source, { recursive: true });
    await write(source, 'src/index.ts', 'export const value = 1;\n');
    await cp(source, target, { recursive: true });
    const config = {
      ...defaultConfig,
      root: source,
      output: workspace,
      strategy: 'walk' as const,
    };
    const baseArchive = await createSnapshot(config, {
      output: '../source-base.zip',
      quiet: true,
    });
    await write(source, 'src/index.ts', 'export const value = 2;\n');
    const updateArchive = await createShiftArchive(
      '../source-base.zip',
      config,
      {
        output: '../source-update.zip',
        quiet: true,
      },
    );
    const update = await loadPackage(updateArchive);
    assert.equal(update.manifest.sourcePackage?.name, 'source-base.zip');
    assert.match(
      update.manifest.sourcePackage?.sha256 ?? '',
      /^sha256:[0-9a-f]{64}$/,
    );

    await applyCommand(updateArchive, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'abort',
      deletePackageOnApply: false,
      deleteSourcePackageOnApply: true,
    });

    assert.equal(
      await readFile(path.join(target, 'src/index.ts'), 'utf8'),
      'export const value = 2;\n',
    );
    await assert.rejects(readFile(baseArchive), /ENOENT/);
    assert.ok((await readFile(updateArchive)).length > 0);

    await write(target, 'src/index.ts', 'export const value = 2;\n');
    const mismatchBase = await createSnapshot(config, {
      output: '../mismatch-base.zip',
      quiet: true,
    });
    await write(source, 'src/index.ts', 'export const value = 3;\n');
    const mismatchUpdate = await createShiftArchive(
      '../mismatch-base.zip',
      config,
      {
        output: '../mismatch-update.zip',
        quiet: true,
      },
    );
    const originalBase = await readFile(mismatchBase);
    await writeFile(
      mismatchBase,
      Buffer.concat([originalBase, Buffer.from('changed')]),
    );
    await applyCommand(mismatchUpdate, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'abort',
      deleteSourcePackageOnApply: true,
    });
    assert.ok((await readFile(mismatchBase)).length > originalBase.length);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('discovers and deletes a snapshot matching the project state before apply', async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), 'package-source-discovery-'),
  );
  const source = path.join(workspace, 'source-project');
  const target = path.join(workspace, 'target-project');
  try {
    await mkdir(source, { recursive: true });
    await write(source, 'src/index.ts', 'export const value = 1;\n');
    await cp(source, target, { recursive: true });

    const baseConfig = {
      ...defaultConfig,
      root: source,
      output: target,
      strategy: 'walk' as const,
    };
    const sourceSnapshot = await createSnapshot(baseConfig, {
      output: path.join(target, 'package.zip'),
      quiet: true,
    });

    await write(source, 'src/index.ts', 'export const value = 2;\n');
    const updateArchive = await createSnapshot(
      { ...baseConfig, output: workspace },
      {
        output: path.join(workspace, 'update-snapshot.zip'),
        quiet: true,
      },
    );
    const update = await loadPackage(updateArchive);
    assert.equal(update.manifest.sourcePackage, undefined);
    assert.equal(update.manifest.kind, 'snapshot');

    await applyCommand(updateArchive, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'overwrite',
      deletePackageOnApply: false,
      deleteSourcePackageOnApply: true,
    });

    assert.equal(
      await readFile(path.join(target, 'src/index.ts'), 'utf8'),
      'export const value = 2;\n',
    );
    await assert.rejects(readFile(sourceSnapshot), /ENOENT/);
    assert.ok((await readFile(updateArchive)).length > 0);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('stores versioned backups outside the project and restores older versions', async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), 'package-backup-history-'),
  );
  const source = path.join(workspace, 'source-project');
  const target = path.join(workspace, 'target-project');
  const previousHome = process.env.STREETRACEING_PACKAGE_HOME;
  process.env.STREETRACEING_PACKAGE_HOME = path.join(workspace, 'package-home');
  try {
    await mkdir(source, { recursive: true });
    await mkdir(target, { recursive: true });
    await write(target, 'src/index.ts', 'export const value = "original";\n');
    const config = {
      ...defaultConfig,
      root: source,
      output: workspace,
      strategy: 'walk' as const,
    };

    await write(source, 'src/index.ts', 'export const value = "one";\n');
    const firstArchive = await createSnapshot(config, {
      output: '../version-one.zip',
      quiet: true,
    });
    await applyCommand(firstArchive, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: true,
      conflictStrategy: 'overwrite',
    });

    await write(source, 'src/index.ts', 'export const value = "two";\n');
    const secondArchive = await createSnapshot(config, {
      output: '../version-two.zip',
      quiet: true,
    });
    await applyCommand(secondArchive, {
      cwd: target,
      dryRun: false,
      yes: true,
      force: false,
      backup: true,
      conflictStrategy: 'overwrite',
    });

    const versions = await listBackupVersions(target);
    assert.equal(versions.length, 2);
    assert.ok(
      versions.every((version) =>
        version.archivePath.startsWith(projectBackupDirectory(target)),
      ),
    );
    await assert.rejects(
      readFile(path.join(target, '.package-backups', 'missing.zip')),
      /ENOENT/,
    );

    const rollback = await restoreBackupVersion(target, '2', true);
    assert.equal(rollback.restoredVersions.length, 2);
    assert.equal(
      await readFile(path.join(target, 'src/index.ts'), 'utf8'),
      'export const value = "original";\n',
    );
    assert.ok((await readFile(rollback.recoveryBackupPath)).length > 0);

    await restoreBackupVersion(target, 'latest', true);
    assert.equal(
      await readFile(path.join(target, 'src/index.ts'), 'utf8'),
      'export const value = "two";\n',
    );
  } finally {
    if (previousHome === undefined)
      delete process.env.STREETRACEING_PACKAGE_HOME;
    else process.env.STREETRACEING_PACKAGE_HOME = previousHome;
    await rm(workspace, { recursive: true, force: true });
  }
});
