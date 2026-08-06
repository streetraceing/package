import { PackageError } from '../errors.js';
import type { PackageConfig, ProjectDependencyConfig } from '../types.js';
import { configSchemaUrl } from './defaults.js';

const knownKeys = new Set<keyof PackageConfig>([
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
  'depends_on',
]);

const stringKeys = [
  'root',
  'output',
  'name',
  'shiftFile',
  'packageManager',
  'packageManagerIgnoreFile',
] as const;

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

const arrayKeys = ['include', 'ignore', 'forceInclude', 'forceIgnore'] as const;
const hookKeys = [
  'beforePackage',
  'afterPackage',
  'beforeApply',
  'afterApply',
] as const;

function invalid(sourceName: string, message: string): never {
  throw new PackageError(`${sourceName}: ${message}`, 'CONFIG_INVALID');
}

export function parseConfigJson(input: string, sourceName: string): unknown {
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

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(
  value: unknown,
  sourceName: string,
  key: string,
): string[] {
  if (!Array.isArray(value) || !value.every(nonEmptyString))
    invalid(sourceName, `${key} must be an array of non-empty strings.`);
  return [...new Set(value as string[])];
}

function hooks(value: unknown, sourceName: string, key: string): string[] {
  if (nonEmptyString(value)) return [value];
  if (Array.isArray(value) && value.every(nonEmptyString))
    return value as string[];
  invalid(
    sourceName,
    `${key} must be a non-empty string or an array of non-empty strings.`,
  );
}

function dependencies(
  value: unknown,
  sourceName: string,
): ProjectDependencyConfig[] {
  if (!Array.isArray(value))
    invalid(sourceName, 'depends_on must be an array.');

  const result: ProjectDependencyConfig[] = [];
  for (const [index, item] of value.entries()) {
    if (nonEmptyString(item)) {
      result.push({ path: item.trim() });
      continue;
    }
    if (!item || typeof item !== 'object' || Array.isArray(item))
      invalid(
        sourceName,
        `depends_on[${index}] must be a path string or an object.`,
      );

    const dependency = item as Record<string, unknown>;
    for (const key of Object.keys(dependency)) {
      if (key !== 'path' && key !== 'name')
        invalid(
          sourceName,
          `unknown depends_on[${index}] option ${JSON.stringify(key)}.`,
        );
    }
    if (!nonEmptyString(dependency.path))
      invalid(
        sourceName,
        `depends_on[${index}].path must be a non-empty string.`,
      );
    if (dependency.name !== undefined && !nonEmptyString(dependency.name))
      invalid(
        sourceName,
        `depends_on[${index}].name must be a non-empty string.`,
      );

    result.push({
      path: dependency.path.trim(),
      ...(typeof dependency.name === 'string'
        ? { name: dependency.name.trim() }
        : {}),
    });
  }
  return result;
}

function validateMonorepo(
  value: unknown,
  sourceName: string,
): Partial<PackageConfig['monorepo']> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(sourceName, 'monorepo must be an object.');
  const input = value as Record<string, unknown>;
  const allowed = new Set([
    'mode',
    'workspacePatterns',
    'selection',
    'includeDependencies',
    'includeDependents',
    'includeRootFiles',
    'shared',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key))
      invalid(sourceName, `unknown monorepo option ${JSON.stringify(key)}.`);
  }
  if (
    input.mode !== undefined &&
    input.mode !== 'auto' &&
    input.mode !== 'off' &&
    input.mode !== 'on'
  )
    invalid(sourceName, 'monorepo.mode must be auto, off, or on.');

  const result: Partial<PackageConfig['monorepo']> = {};
  if (input.mode !== undefined)
    result.mode = input.mode as PackageConfig['monorepo']['mode'];
  for (const key of ['workspacePatterns', 'selection', 'shared'] as const) {
    if (input[key] !== undefined)
      result[key] = stringArray(input[key], sourceName, `monorepo.${key}`);
  }
  for (const key of [
    'includeDependencies',
    'includeDependents',
    'includeRootFiles',
  ] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean')
        invalid(sourceName, `monorepo.${key} must be a boolean.`);
      result[key] = input[key] as boolean;
    }
  }
  return result;
}

export function validateConfig(
  value: unknown,
  sourceName: string,
): Partial<PackageConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PackageError(
      `${sourceName} must contain an object.`,
      'CONFIG_INVALID',
    );

  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!knownKeys.has(key as keyof PackageConfig))
      invalid(sourceName, `unknown option ${JSON.stringify(key)}.`);
  }

  if (input.$schema !== undefined && input.$schema !== configSchemaUrl)
    invalid(sourceName, `$schema must be ${configSchemaUrl}.`);

  const result: Record<string, unknown> = {};
  if (input.$schema !== undefined) result.$schema = input.$schema;

  for (const key of stringKeys) {
    if (input[key] === undefined) continue;
    if (!nonEmptyString(input[key]))
      invalid(sourceName, `${key} must be a non-empty string.`);
    result[key] = (input[key] as string).trim();
  }

  for (const key of booleanKeys) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'boolean')
      invalid(sourceName, `${key} must be a boolean.`);
    result[key] = input[key];
  }

  for (const key of arrayKeys) {
    if (input[key] !== undefined)
      result[key] = stringArray(input[key], sourceName, key);
  }

  for (const key of hookKeys) {
    if (input[key] !== undefined)
      result[key] = hooks(input[key], sourceName, key);
  }

  if (input.type !== undefined && input.type !== 'zip')
    invalid(sourceName, 'type must be zip.');
  if (input.type !== undefined) result.type = input.type;

  if (
    input.strategy !== undefined &&
    input.strategy !== 'git' &&
    input.strategy !== 'walk'
  )
    invalid(sourceName, 'strategy must be git or walk.');
  if (input.strategy !== undefined) result.strategy = input.strategy;

  if (
    input.sensitiveFiles !== undefined &&
    input.sensitiveFiles !== 'warn' &&
    input.sensitiveFiles !== 'error' &&
    input.sensitiveFiles !== 'allow'
  )
    invalid(sourceName, 'sensitiveFiles must be warn, error, or allow.');
  if (input.sensitiveFiles !== undefined)
    result.sensitiveFiles = input.sensitiveFiles;

  if (
    input.conflictStrategy !== undefined &&
    input.conflictStrategy !== 'abort' &&
    input.conflictStrategy !== 'overwrite' &&
    input.conflictStrategy !== 'skip'
  )
    invalid(sourceName, 'conflictStrategy must be abort, overwrite, or skip.');
  if (input.conflictStrategy !== undefined)
    result.conflictStrategy = input.conflictStrategy;

  if (input.compressionLevel !== undefined) {
    const level = input.compressionLevel;
    if (
      typeof level !== 'number' ||
      !Number.isInteger(level) ||
      level < 0 ||
      level > 9
    )
      invalid(sourceName, 'compressionLevel must be an integer from 0 to 9.');
    result.compressionLevel = level;
  }

  if (input.renameThreshold !== undefined) {
    const threshold = input.renameThreshold;
    if (
      typeof threshold !== 'number' ||
      !Number.isFinite(threshold) ||
      threshold < 0 ||
      threshold > 1
    )
      invalid(sourceName, 'renameThreshold must be between 0 and 1.');
    result.renameThreshold = threshold;
  }

  if (input.depends_on !== undefined)
    result.depends_on = dependencies(input.depends_on, sourceName);
  if (input.monorepo !== undefined)
    result.monorepo = validateMonorepo(input.monorepo, sourceName);

  if (
    result.npmignore !== undefined &&
    result.packageManagerIgnore !== undefined &&
    result.npmignore !== result.packageManagerIgnore
  )
    invalid(sourceName, 'npmignore and packageManagerIgnore cannot disagree.');

  if (result.npmignore !== undefined)
    result.packageManagerIgnore = result.npmignore;
  else if (result.packageManagerIgnore !== undefined)
    result.npmignore = result.packageManagerIgnore;

  return result as Partial<PackageConfig>;
}
