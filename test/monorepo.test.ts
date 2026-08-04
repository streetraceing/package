import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { defaultConfig } from '../src/config.js';
import { collectProjectFiles } from '../src/files/collect.js';
import {
  discoverWorkspaces,
  resolveWorkspaceScope,
} from '../src/workspaces/discover.js';
import { createSnapshot } from '../src/commands/zip.js';
import { createShiftArchive } from '../src/commands/shift.js';
import { loadPackage } from '../src/manifest/load.js';

async function write(
  root: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const target = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

function monorepoConfig(root: string) {
  return {
    ...defaultConfig,
    root,
    output: root,
    strategy: 'walk' as const,
    gitignore: false,
    saveDeletedCache: false,
    monorepo: {
      ...defaultConfig.monorepo,
    },
  };
}

async function createFixture(root: string): Promise<void> {
  await write(
    root,
    'package.json',
    `${JSON.stringify(
      {
        name: '@acme/root',
        private: true,
        workspaces: ['packages/*', 'apps/*'],
      },
      null,
      2,
    )}\n`,
  );
  await write(
    root,
    'pnpm-workspace.yaml',
    "packages:\n  - 'packages/*'\n  - 'apps/*'\n",
  );
  await write(root, 'pnpm-lock.yaml', 'lockfileVersion: 9\n');
  await write(root, 'turbo.json', '{"tasks":{}}\n');
  await write(root, 'docs/guide.md', 'not shared by default\n');
  await write(root, 'scripts/build.mjs', 'console.log("build")\n');

  await write(
    root,
    'packages/core/package.json',
    '{"name":"@acme/core","version":"1.0.0"}\n',
  );
  await write(
    root,
    'packages/core/src/index.ts',
    'export const core = true;\n',
  );
  await write(
    root,
    'packages/api/package.json',
    '{"name":"@acme/api","version":"1.0.0","dependencies":{"@acme/core":"workspace:*"}}\n',
  );
  await write(root, 'packages/api/src/index.ts', 'export const api = true;\n');
  await write(
    root,
    'apps/web/package.json',
    '{"name":"@acme/web","private":true,"dependencies":{"@acme/api":"workspace:*"}}\n',
  );
  await write(root, 'apps/web/src/index.ts', 'export const web = true;\n');
  await write(
    root,
    'apps/admin/package.json',
    '{"name":"@acme/admin","private":true}\n',
  );
  await write(root, 'apps/admin/src/index.ts', 'export const admin = true;\n');
}

test('literal workspace paths do not include generated nested packages', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'package-monorepo-next-'));
  try {
    await write(
      root,
      'package.json',
      JSON.stringify({
        name: 'codeissue',
        private: true,
        workspaces: ['website', 'backend'],
      }),
    );
    await write(
      root,
      'website/package.json',
      '{"name":"codeissue-website","private":true}\n',
    );
    await write(
      root,
      'backend/package.json',
      '{"name":"codeissue-backend","private":true}\n',
    );
    await write(root, 'website/.next/dev/package.json', '{"name":"dev"}\n');
    await write(
      root,
      'website/.next/dev/build/package.json',
      '{"name":"build"}\n',
    );
    await write(
      root,
      'website/dist/package.json',
      '{"name":"generated-dist"}\n',
    );

    const discovery = await discoverWorkspaces(monorepoConfig(root));
    assert.deepEqual(
      discovery.workspaces.map((workspace) => [workspace.name, workspace.path]),
      [
        ['codeissue-backend', 'backend'],
        ['codeissue-website', 'website'],
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detects, selects, and expands monorepo workspaces', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'package-monorepo-'));
  try {
    await createFixture(root);
    const config = monorepoConfig(root);
    const discovery = await discoverWorkspaces(config);
    assert.deepEqual(
      discovery.workspaces.map((workspace) => workspace.name),
      ['@acme/admin', '@acme/web', '@acme/api', '@acme/core'],
    );
    assert.ok(discovery.sources.includes('package.json#workspaces'));
    assert.ok(discovery.sources.includes('pnpm-workspace.yaml'));

    const selectedConfig = {
      ...config,
      monorepo: {
        ...config.monorepo,
        selection: ['@acme/web'],
        includeDependencies: true,
      },
    };
    const scope = await resolveWorkspaceScope(selectedConfig);
    assert.deepEqual(
      scope?.workspaces.map((workspace) => workspace.name).sort(),
      ['@acme/api', '@acme/core', '@acme/web'],
    );

    const dependentScope = await resolveWorkspaceScope({
      ...config,
      monorepo: {
        ...config.monorepo,
        selection: ['@acme/core'],
        includeDependents: true,
      },
    });
    assert.deepEqual(
      dependentScope?.workspaces.map((workspace) => workspace.name).sort(),
      ['@acme/api', '@acme/core', '@acme/web'],
    );

    const appsScope = await resolveWorkspaceScope({
      ...config,
      monorepo: {
        ...config.monorepo,
        selection: ['apps/*'],
        includeRootFiles: false,
      },
    });
    assert.deepEqual(
      appsScope?.workspaces.map((workspace) => workspace.name).sort(),
      ['@acme/admin', '@acme/web'],
    );
    const { files: appFiles } = await collectProjectFiles(
      {
        ...config,
        monorepo: {
          ...config.monorepo,
          selection: ['apps/*'],
          includeRootFiles: false,
        },
      },
      undefined,
      undefined,
      appsScope,
    );
    assert.ok(!appFiles.some((file) => file.relativePath === 'package.json'));

    const { files } = await collectProjectFiles(selectedConfig);
    const paths = files.map((file) => file.relativePath);
    assert.ok(paths.includes('apps/web/src/index.ts'));
    assert.ok(paths.includes('packages/api/src/index.ts'));
    assert.ok(paths.includes('packages/core/src/index.ts'));
    assert.ok(paths.includes('package.json'));
    assert.ok(paths.includes('pnpm-lock.yaml'));
    assert.ok(paths.includes('turbo.json'));
    assert.ok(!paths.includes('apps/admin/src/index.ts'));
    assert.ok(!paths.includes('docs/guide.md'));
    assert.ok(!paths.includes('scripts/build.mjs'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stores workspace scope in snapshots and uses workspace-aware names', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'package-monorepo-archive-'));
  try {
    await createFixture(root);
    const config = monorepoConfig(root);
    config.monorepo.selection = ['@acme/api'];

    const archivePath = await createSnapshot(config, { quiet: true });
    assert.equal(archivePath, path.join(root, 'api.zip'));
    const pkg = await loadPackage(archivePath);
    assert.deepEqual(pkg.manifest.monorepo, {
      root: '.',
      workspaces: [{ name: '@acme/api', path: 'packages/api' }],
      includeRootFiles: true,
    });
    assert.ok(pkg.entries.has('packages/api/src/index.ts'));
    assert.ok(pkg.entries.has('package.json'));
    assert.ok(!pkg.entries.has('packages/core/src/index.ts'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('shift inherits workspace scope and can remove a deleted workspace', async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), 'package-monorepo-shift-'),
  );
  const root = path.join(workspace, 'repo');
  try {
    await mkdir(root, { recursive: true });
    await write(
      root,
      'package.json',
      '{"name":"@acme/root","private":true,"workspaces":["packages/*"]}\n',
    );
    await write(
      root,
      'packages/obsolete/package.json',
      '{"name":"@acme/obsolete","version":"1.0.0"}\n',
    );
    await write(
      root,
      'packages/obsolete/src/index.ts',
      'export const old = true;\n',
    );

    const selected = monorepoConfig(root);
    selected.output = workspace;
    selected.monorepo.selection = ['@acme/obsolete'];
    const base = await createSnapshot(selected, {
      output: path.join(workspace, 'base.zip'),
      quiet: true,
    });

    await rm(path.join(root, 'packages/obsolete'), {
      recursive: true,
      force: true,
    });
    const inherited = monorepoConfig(root);
    inherited.output = workspace;
    const update = await createShiftArchive(base, inherited, {
      output: path.join(workspace, 'update.zip'),
      quiet: true,
    });
    const pkg = await loadPackage(update);
    assert.deepEqual(pkg.manifest.monorepo?.workspaces, [
      { name: '@acme/obsolete', path: 'packages/obsolete' },
    ]);
    const removals =
      pkg.shift?.instructions
        .filter((instruction) => instruction.type === 'REMOVE')
        .map((instruction) => instruction.path) ?? [];
    assert.ok(removals.includes('packages/obsolete/package.json'));
    assert.ok(removals.includes('packages/obsolete/src/index.ts'));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('workspace scope mismatch requires a new base snapshot', async () => {
  const workspace = await mkdtemp(
    path.join(tmpdir(), 'package-monorepo-scope-'),
  );
  const root = path.join(workspace, 'repo');
  try {
    await mkdir(root, { recursive: true });
    await createFixture(root);
    const api = monorepoConfig(root);
    api.output = workspace;
    api.monorepo.selection = ['@acme/api'];
    const base = await createSnapshot(api, {
      output: path.join(workspace, 'base.zip'),
      quiet: true,
    });

    const web = monorepoConfig(root);
    web.output = workspace;
    web.monorepo.selection = ['@acme/web'];
    await assert.rejects(
      createShiftArchive(base, web, {
        output: path.join(workspace, 'update.zip'),
        quiet: true,
      }),
      /Workspace selection does not match the base snapshot/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
