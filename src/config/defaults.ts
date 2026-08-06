import type { PackageConfig } from '../types.js';

export const documentationUrl = 'https://streetraceing.github.io/package';
export const configSchemaUrl = `${documentationUrl}/schema.json`;

const sharedMonorepoFiles = [
  'package.json',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'lerna.json',
  'rush.json',
  'nx.json',
  'turbo.json',
  'tsconfig.json',
  'tsconfig.base.json',
  '.npmrc',
  '.yarnrc.yml',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.packagerc',
  '.packagerc.json',
] as const;

export function createDefaultConfig(): PackageConfig {
  return {
    type: 'zip',
    root: '.',
    output: '.',
    name: '{folder}.zip',
    strategy: 'git',
    gitignore: true,
    npmignore: false,
    packageManager: 'npm',
    packageManagerIgnore: false,
    packageManagerIgnoreFile: '.npmignore',
    include: ['**/*'],
    ignore: [],
    forceInclude: [],
    forceIgnore: [],
    dot: true,
    followSymlinks: false,
    includeEmptyDirectories: false,
    manifest: true,
    shiftFile: '.packageshift',
    compressionLevel: 9,
    deterministic: true,
    preserveMode: true,
    preserveMtime: false,
    sensitiveFiles: 'warn',
    backupOnApply: true,
    conflictStrategy: 'abort',
    renameDetection: true,
    renameThreshold: 0.8,
    beforePackage: [],
    afterPackage: [],
    beforeApply: [],
    afterApply: [],
    deletePackageOnApply: false,
    deleteSourcePackageOnApply: false,
    saveDeletedCache: true,
    depends_on: [],
    monorepo: {
      mode: 'auto',
      workspacePatterns: [],
      selection: [],
      includeDependencies: false,
      includeDependents: false,
      includeRootFiles: true,
      shared: [...sharedMonorepoFiles],
    },
  };
}

/** Stable public defaults. Never return this object as mutable runtime state. */
export const defaultConfig: PackageConfig = createDefaultConfig();

export interface StarterConfigOptions {
  full?: boolean;
  strategy?: PackageConfig['strategy'];
  gitignore?: boolean;
  packageManager?: string;
}

export function starterConfig(
  options: StarterConfigOptions = {},
): Record<string, unknown> {
  const defaults = createDefaultConfig();
  const strategy = options.strategy ?? defaults.strategy;
  const gitignore = options.gitignore ?? defaults.gitignore;
  const packageManager = options.packageManager ?? defaults.packageManager;

  if (options.full) {
    return {
      $schema: configSchemaUrl,
      ...defaults,
      strategy,
      gitignore,
      packageManager,
    };
  }

  return {
    $schema: configSchemaUrl,
    name: defaults.name,
    strategy,
    gitignore,
    ...(packageManager === defaults.packageManager ? {} : { packageManager }),
  };
}

export function renderStarterConfig(
  options: StarterConfigOptions = {},
): string {
  return `${JSON.stringify(starterConfig(options), null, 2)}\n`;
}
