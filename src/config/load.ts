import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { PackageConfig } from '../types.js';
import { PackageError } from '../errors.js';
import { createDefaultConfig } from './defaults.js';
import { parseConfigJson, validateConfig } from './validation.js';

interface ConfigSource {
  directory: string;
  path?: string;
}

const configSources = new WeakMap<PackageConfig, ConfigSource>();

export interface LoadedConfig {
  config: PackageConfig;
  configDirectory: string;
  configPath?: string;
}

function mergeConfig(partial: Partial<PackageConfig>): PackageConfig {
  const defaults = createDefaultConfig();
  return {
    ...defaults,
    ...partial,
    include: partial.include ? [...partial.include] : defaults.include,
    ignore: partial.ignore ? [...partial.ignore] : defaults.ignore,
    forceInclude: partial.forceInclude
      ? [...partial.forceInclude]
      : defaults.forceInclude,
    forceIgnore: partial.forceIgnore
      ? [...partial.forceIgnore]
      : defaults.forceIgnore,
    beforePackage: partial.beforePackage
      ? [...partial.beforePackage]
      : defaults.beforePackage,
    afterPackage: partial.afterPackage
      ? [...partial.afterPackage]
      : defaults.afterPackage,
    beforeApply: partial.beforeApply
      ? [...partial.beforeApply]
      : defaults.beforeApply,
    afterApply: partial.afterApply
      ? [...partial.afterApply]
      : defaults.afterApply,
    depends_on: partial.depends_on
      ? partial.depends_on.map((dependency) => ({ ...dependency }))
      : defaults.depends_on,
    monorepo: {
      ...defaults.monorepo,
      ...(partial.monorepo ?? {}),
      workspacePatterns: partial.monorepo?.workspacePatterns
        ? [...partial.monorepo.workspacePatterns]
        : defaults.monorepo.workspacePatterns,
      selection: partial.monorepo?.selection
        ? [...partial.monorepo.selection]
        : defaults.monorepo.selection,
      shared: partial.monorepo?.shared
        ? [...partial.monorepo.shared]
        : defaults.monorepo.shared,
    },
  };
}

export async function loadConfig(
  cwd: string,
  explicitPath?: string,
): Promise<LoadedConfig> {
  const resolvedCwd = path.resolve(cwd);
  const candidates = explicitPath
    ? [path.resolve(resolvedCwd, explicitPath)]
    : [
        path.join(resolvedCwd, '.packagerc'),
        path.join(resolvedCwd, '.packagerc.json'),
      ];

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = validateConfig(parseConfigJson(raw, candidate), candidate);
      return {
        config: mergeConfig(parsed),
        configPath: candidate,
        configDirectory: path.dirname(candidate),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }

  if (explicitPath) {
    throw new PackageError(
      `Configuration file does not exist: ${path.resolve(resolvedCwd, explicitPath)}`,
      'CONFIG_NOT_FOUND',
    );
  }

  return {
    config: createDefaultConfig(),
    configDirectory: resolvedCwd,
  };
}

export function resolveConfigPaths(
  config: PackageConfig,
  configDirectory: string,
  configPath?: string,
): PackageConfig {
  const resolvedDirectory = path.resolve(configDirectory);
  const root = path.resolve(resolvedDirectory, config.root);
  const output = path.resolve(root, config.output);
  const resolved = { ...config, root, output };
  configSources.set(resolved, {
    directory: resolvedDirectory,
    ...(configPath ? { path: path.resolve(configPath) } : {}),
  });
  return resolved;
}

export function configDirectoryOf(config: PackageConfig): string {
  return configSources.get(config)?.directory ?? config.root;
}

export function configPathOf(config: PackageConfig): string | undefined {
  return configSources.get(config)?.path;
}
