import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { PackageError } from './errors.js';
import type { PackageConfig } from './types.js';

export const documentationUrl = 'https://streetraceing.github.io/package';
export const configSchemaUrl = `${documentationUrl}/schema.json`;

export const defaultConfig: PackageConfig = {
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
  monorepo: {
    mode: 'auto',
    workspacePatterns: [],
    selection: [],
    includeDependencies: false,
    includeDependents: false,
    includeRootFiles: true,
    shared: [
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
    ],
  },
};

function parseJson(input: string, sourceName: string): unknown {
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new PackageError(
      `Cannot parse ${sourceName}: ${(error as Error).message}. ` +
        'Configuration files must use strict JSON: double-quoted keys and strings, no comments, and no trailing commas.',
      'CONFIG_PARSE_ERROR',
    );
  }
}

function validateConfig(
  value: unknown,
  sourceName: string,
): Partial<PackageConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PackageError(
      `${sourceName} must contain an object.`,
      'CONFIG_INVALID',
    );
  }

  const config = value as Record<string, unknown>;
  const knownKeys = new Set([
    '$schema',
    'type',
    'root',
    'output',
    'name',
    'strategy',
    'gitignore',
    'npmignore',
    'packageManager',
    'packageManagerIgnore',
    'packageManagerIgnoreFile',
    'include',
    'ignore',
    'forceInclude',
    'forceIgnore',
    'dot',
    'followSymlinks',
    'includeEmptyDirectories',
    'manifest',
    'shiftFile',
    'compressionLevel',
    'deterministic',
    'preserveMode',
    'preserveMtime',
    'sensitiveFiles',
    'backupOnApply',
    'conflictStrategy',
    'renameDetection',
    'renameThreshold',
    'beforePackage',
    'afterPackage',
    'beforeApply',
    'afterApply',
    'deletePackageOnApply',
    'deleteSourcePackageOnApply',
    'saveDeletedCache',
    'monorepo',
  ]);

  for (const key of Object.keys(config)) {
    if (!knownKeys.has(key)) {
      throw new PackageError(
        `${sourceName}: unknown option ${JSON.stringify(key)}.`,
        'CONFIG_INVALID',
      );
    }
  }

  if (config.$schema !== undefined && config.$schema !== configSchemaUrl) {
    throw new PackageError(
      `${sourceName}: $schema must be ${configSchemaUrl}.`,
      'CONFIG_INVALID',
    );
  }

  const stringKeys = [
    'root',
    'output',
    'name',
    'shiftFile',
    'packageManager',
    'packageManagerIgnoreFile',
  ] as const;
  for (const key of stringKeys) {
    if (
      config[key] !== undefined &&
      (typeof config[key] !== 'string' || config[key].length === 0)
    ) {
      throw new PackageError(
        `${sourceName}: ${key} must be a non-empty string.`,
        'CONFIG_INVALID',
      );
    }
  }

  const booleanKeys = [
    'gitignore',
    'npmignore',
    'packageManagerIgnore',
    'dot',
    'followSymlinks',
    'includeEmptyDirectories',
    'manifest',
    'deterministic',
    'preserveMode',
    'preserveMtime',
    'backupOnApply',
    'renameDetection',
    'deletePackageOnApply',
    'deleteSourcePackageOnApply',
    'saveDeletedCache',
  ] as const;
  for (const key of booleanKeys) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new PackageError(
        `${sourceName}: ${key} must be a boolean.`,
        'CONFIG_INVALID',
      );
    }
  }

  const arrayKeys = [
    'include',
    'ignore',
    'forceInclude',
    'forceIgnore',
  ] as const;
  for (const key of arrayKeys) {
    if (
      config[key] !== undefined &&
      (!Array.isArray(config[key]) ||
        !(config[key] as unknown[]).every(
          (item) => typeof item === 'string' && item.length > 0,
        ))
    ) {
      throw new PackageError(
        `${sourceName}: ${key} must be an array of non-empty strings.`,
        'CONFIG_INVALID',
      );
    }
  }

  if (
    config.npmignore !== undefined &&
    config.packageManagerIgnore !== undefined &&
    config.npmignore !== config.packageManagerIgnore
  ) {
    throw new PackageError(
      `${sourceName}: npmignore and packageManagerIgnore cannot disagree.`,
      'CONFIG_INVALID',
    );
  }
  if (
    config.packageManagerIgnore === undefined &&
    config.npmignore !== undefined
  ) {
    config.packageManagerIgnore = config.npmignore;
  }

  const hookKeys = [
    'beforePackage',
    'afterPackage',
    'beforeApply',
    'afterApply',
  ] as const;
  for (const key of hookKeys) {
    const value = config[key];
    if (value === undefined) continue;
    if (typeof value === 'string' && value.length > 0) {
      config[key] = [value];
      continue;
    }
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === 'string' && item.length > 0)
    )
      continue;
    throw new PackageError(
      `${sourceName}: ${key} must be a non-empty string or an array of non-empty strings.`,
      'CONFIG_INVALID',
    );
  }

  if (config.type !== undefined && config.type !== 'zip') {
    throw new PackageError(
      `${sourceName}: type must be zip.`,
      'CONFIG_INVALID',
    );
  }
  if (
    config.strategy !== undefined &&
    config.strategy !== 'git' &&
    config.strategy !== 'walk'
  ) {
    throw new PackageError(
      `${sourceName}: strategy must be git or walk.`,
      'CONFIG_INVALID',
    );
  }
  if (
    config.sensitiveFiles !== undefined &&
    config.sensitiveFiles !== 'warn' &&
    config.sensitiveFiles !== 'error' &&
    config.sensitiveFiles !== 'allow'
  ) {
    throw new PackageError(
      `${sourceName}: sensitiveFiles must be warn, error, or allow.`,
      'CONFIG_INVALID',
    );
  }
  if (
    config.conflictStrategy !== undefined &&
    config.conflictStrategy !== 'abort' &&
    config.conflictStrategy !== 'overwrite' &&
    config.conflictStrategy !== 'skip'
  ) {
    throw new PackageError(
      `${sourceName}: conflictStrategy must be abort, overwrite, or skip.`,
      'CONFIG_INVALID',
    );
  }

  if (config.compressionLevel !== undefined) {
    const level = config.compressionLevel;
    if (
      typeof level !== 'number' ||
      !Number.isInteger(level) ||
      level < 0 ||
      level > 9
    ) {
      throw new PackageError(
        `${sourceName}: compressionLevel must be an integer from 0 to 9.`,
        'CONFIG_INVALID',
      );
    }
  }
  if (config.renameThreshold !== undefined) {
    const threshold = config.renameThreshold;
    if (
      typeof threshold !== 'number' ||
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      threshold > 1
    ) {
      throw new PackageError(
        `${sourceName}: renameThreshold must be between 0 and 1.`,
        'CONFIG_INVALID',
      );
    }
  }

  if (config.monorepo !== undefined) {
    if (
      !config.monorepo ||
      typeof config.monorepo !== 'object' ||
      Array.isArray(config.monorepo)
    ) {
      throw new PackageError(
        `${sourceName}: monorepo must be an object.`,
        'CONFIG_INVALID',
      );
    }
    const monorepo = config.monorepo as Record<string, unknown>;
    const knownMonorepoKeys = new Set([
      'mode',
      'workspacePatterns',
      'selection',
      'includeDependencies',
      'includeDependents',
      'includeRootFiles',
      'shared',
    ]);
    for (const key of Object.keys(monorepo)) {
      if (!knownMonorepoKeys.has(key)) {
        throw new PackageError(
          `${sourceName}: unknown monorepo option ${JSON.stringify(key)}.`,
          'CONFIG_INVALID',
        );
      }
    }
    if (
      monorepo.mode !== undefined &&
      monorepo.mode !== 'auto' &&
      monorepo.mode !== 'off' &&
      monorepo.mode !== 'on'
    ) {
      throw new PackageError(
        `${sourceName}: monorepo.mode must be auto, off, or on.`,
        'CONFIG_INVALID',
      );
    }
    for (const key of ['workspacePatterns', 'selection', 'shared'] as const) {
      const value = monorepo[key];
      if (
        value !== undefined &&
        (!Array.isArray(value) ||
          !value.every((item) => typeof item === 'string' && item.length > 0))
      ) {
        throw new PackageError(
          `${sourceName}: monorepo.${key} must be an array of non-empty strings.`,
          'CONFIG_INVALID',
        );
      }
    }
    for (const key of [
      'includeDependencies',
      'includeDependents',
      'includeRootFiles',
    ] as const) {
      if (monorepo[key] !== undefined && typeof monorepo[key] !== 'boolean') {
        throw new PackageError(
          `${sourceName}: monorepo.${key} must be a boolean.`,
          'CONFIG_INVALID',
        );
      }
    }
  }
  return config as Partial<PackageConfig>;
}

export async function loadConfig(
  cwd: string,
  explicitPath?: string,
): Promise<{ config: PackageConfig; configPath?: string }> {
  const candidates = explicitPath
    ? [path.resolve(cwd, explicitPath)]
    : [path.join(cwd, '.packagerc'), path.join(cwd, '.packagerc.json')];
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = validateConfig(parseJson(raw, candidate), candidate);
      return {
        config: {
          ...defaultConfig,
          ...parsed,
          monorepo: {
            ...defaultConfig.monorepo,
            ...(parsed.monorepo ?? {}),
          },
        },
        configPath: candidate,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  return { config: { ...defaultConfig } };
}

export function resolveConfigPaths(
  config: PackageConfig,
  cwd: string,
): PackageConfig {
  const root = path.resolve(cwd, config.root);
  const output = path.resolve(root, config.output);
  return { ...config, root, output };
}

export const exampleConfig = `${JSON.stringify(
  { $schema: configSchemaUrl, ...defaultConfig },
  null,
  2,
)}\n`;
