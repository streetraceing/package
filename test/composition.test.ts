import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadConfig, resolveConfigPaths } from '../src/config.js';
import { createSnapshot } from '../src/commands/zip.js';
import { createShiftArchive } from '../src/commands/shift.js';
import { applyCommand } from '../src/commands/apply.js';
import { loadPackage } from '../src/manifest/load.js';
import { resolveProjectComposition } from '../src/projects/composition.js';

async function write(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

function projectConfig(
  dependsOn: unknown[],
  afterApplyFile: string,
  ignore: string[] = [],
): string {
  return `${JSON.stringify(
    {
      strategy: 'walk',
      gitignore: false,
      saveDeletedCache: false,
      backupOnApply: false,
      ignore,
      depends_on: dependsOn,
      afterApply: [
        `node -e "require('node:fs').writeFileSync('${afterApplyFile}', process.cwd())"`,
      ],
    },
    null,
    2,
  )}\n`;
}

async function loadResolvedConfig(root: string) {
  const loaded = await loadConfig(root);
  return resolveConfigPaths(loaded.config, root);
}

test('depends_on composes sibling projects with local configs and project-local apply hooks', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'package-composition-'));
  const source = path.join(workspace, 'source', 'codeissue');
  const target = path.join(workspace, 'target', 'codeissue');
  const website = path.join(source, 'website');
  try {
    await write(
      source,
      'website/package.json',
      '{"name":"@codeissue/website","private":true}\n',
    );
    await write(
      source,
      'backend/package.json',
      '{"name":"@codeissue/backend","private":true}\n',
    );
    await write(
      source,
      'website/.packagerc',
      projectConfig(
        [{ path: '../backend', name: '@codeissue/backend' }],
        'website-after-apply.txt',
        ['ignored-website.txt', '.packagerc'],
      ),
    );
    await write(
      source,
      'backend/.packagerc',
      projectConfig([], 'backend-after-apply.txt', [
        'ignored-backend.txt',
        '.packagerc',
      ]),
    );
    await write(source, 'website/src/page.ts', 'export const page = 1;\n');
    await write(source, 'backend/src/api.ts', 'export const api = 1;\n');
    await write(source, 'website/ignored-website.txt', 'ignore\n');
    await write(source, 'backend/ignored-backend.txt', 'ignore\n');
    await cp(source, target, { recursive: true });

    const config = await loadResolvedConfig(website);
    const composition = await resolveProjectComposition(config);
    assert.equal(composition?.root, source);
    assert.equal(composition?.entry, '@codeissue/website');
    assert.deepEqual(
      composition?.projects.map((project) => [
        project.name,
        project.archivePath,
        project.dependsOn,
      ]),
      [
        ['@codeissue/backend', 'backend', []],
        ['@codeissue/website', 'website', ['@codeissue/backend']],
      ],
    );

    const baseArchive = await createSnapshot(config, {
      output: 'base.zip',
      quiet: true,
    });
    const base = await loadPackage(baseArchive);
    assert.deepEqual(base.manifest.composition, {
      root: '.',
      entry: '@codeissue/website',
      projects: [
        {
          name: '@codeissue/backend',
          path: 'backend',
          configPath: 'backend/.packagerc',
          dependsOn: [],
        },
        {
          name: '@codeissue/website',
          path: 'website',
          configPath: 'website/.packagerc',
          dependsOn: ['@codeissue/backend'],
        },
      ],
    });
    assert.ok(base.entries.has('website/src/page.ts'));
    assert.ok(base.entries.has('backend/src/api.ts'));
    assert.ok(base.entries.has('website/.packagerc'));
    assert.ok(base.entries.has('backend/.packagerc'));
    assert.ok(!base.entries.has('website/ignored-website.txt'));
    assert.ok(!base.entries.has('backend/ignored-backend.txt'));

    await write(source, 'website/src/page.ts', 'export const page = 2;\n');
    await write(source, 'backend/src/api.ts', 'export const api = 2;\n');
    const updateArchive = await createShiftArchive(baseArchive, config, {
      output: 'update.zip',
      quiet: true,
    });

    const targetConfig = await loadResolvedConfig(path.join(target, 'website'));
    const targetComposition = await resolveProjectComposition(targetConfig);
    assert.ok(targetComposition);

    await applyCommand(updateArchive, {
      cwd: targetConfig.root,
      composition: targetComposition,
      dryRun: false,
      yes: true,
      force: false,
      backup: false,
      conflictStrategy: 'abort',
      saveDeletedCache: false,
      deletePackageOnApply: false,
      deleteSourcePackageOnApply: false,
    });

    assert.equal(
      await readFile(path.join(target, 'website/src/page.ts'), 'utf8'),
      'export const page = 2;\n',
    );
    assert.equal(
      await readFile(path.join(target, 'backend/src/api.ts'), 'utf8'),
      'export const api = 2;\n',
    );
    assert.equal(
      await readFile(
        path.join(target, 'website/website-after-apply.txt'),
        'utf8',
      ),
      path.join(target, 'website'),
    );
    assert.equal(
      await readFile(
        path.join(target, 'backend/backend-after-apply.txt'),
        'utf8',
      ),
      path.join(target, 'backend'),
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('depends_on rejects circular project graphs', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'package-composition-cycle-'));
  try {
    await write(root, 'website/package.json', '{"name":"website"}\n');
    await write(root, 'backend/package.json', '{"name":"backend"}\n');
    await write(
      root,
      'website/.packagerc',
      projectConfig([{ path: '../backend' }], 'website.txt'),
    );
    await write(
      root,
      'backend/.packagerc',
      projectConfig([{ path: '../website' }], 'backend.txt'),
    );
    const config = await loadResolvedConfig(path.join(root, 'website'));
    await assert.rejects(
      resolveProjectComposition(config),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('Circular depends_on chain'),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('depends_on accepts path shorthand and object entries', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'package-config-depends-'));
  try {
    await write(
      root,
      '.packagerc',
      JSON.stringify({
        depends_on: [
          '../backend',
          { path: '../worker', name: '@codeissue/worker' },
        ],
      }),
    );
    const loaded = await loadConfig(root);
    assert.deepEqual(loaded.config.depends_on, [
      { path: '../backend' },
      { path: '../worker', name: '@codeissue/worker' },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
