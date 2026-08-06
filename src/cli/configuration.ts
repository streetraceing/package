import type { PackageConfig } from '../types.js';
import type { ParsedArgs } from './args.js';
import type { LoadedConfig } from '../config.js';
import { resolveConfigPaths } from '../config.js';

function cloneArray<T>(value: readonly T[]): T[] {
  return [...value];
}

function mergeList(
  base: readonly string[],
  override: readonly string[] | undefined,
  mode: 'append' | 'replace',
): string[] {
  if (!override) return cloneArray(base);
  const values = mode === 'append' ? [...base, ...override] : [...override];
  return [...new Set(values)];
}

export function resolveEffectiveConfig(
  loaded: LoadedConfig,
  args: ParsedArgs,
  workspaceSelectors: readonly string[],
): PackageConfig {
  const overrides = args.configOverrides;
  const base = loaded.config;
  const monorepo = {
    ...base.monorepo,
    ...args.monorepoOverrides,
    workspacePatterns: mergeList(
      base.monorepo.workspacePatterns,
      args.monorepoOverrides.workspacePatterns,
      'append',
    ),
    selection: args.allWorkspaces
      ? ['*']
      : workspaceSelectors.length > 0
        ? [...new Set(workspaceSelectors)]
        : cloneArray(base.monorepo.selection),
    shared: cloneArray(base.monorepo.shared),
  };

  const merged: PackageConfig = {
    ...base,
    ...overrides,
    include: mergeList(base.include, overrides.include, 'replace'),
    ignore: mergeList(base.ignore, overrides.ignore, 'append'),
    forceInclude: mergeList(
      base.forceInclude,
      overrides.forceInclude,
      'append',
    ),
    forceIgnore: mergeList(base.forceIgnore, overrides.forceIgnore, 'append'),
    beforePackage: cloneArray(base.beforePackage),
    afterPackage: cloneArray(base.afterPackage),
    beforeApply: cloneArray(base.beforeApply),
    afterApply: cloneArray(base.afterApply),
    depends_on: base.depends_on.map((dependency) => ({ ...dependency })),
    monorepo,
  };

  if (overrides.npmignore !== undefined) {
    merged.npmignore = overrides.npmignore;
    merged.packageManagerIgnore = overrides.npmignore;
  } else if (overrides.packageManagerIgnore !== undefined) {
    merged.packageManagerIgnore = overrides.packageManagerIgnore;
    merged.npmignore = overrides.packageManagerIgnore;
  }

  return resolveConfigPaths(merged, loaded.configDirectory, loaded.configPath);
}
