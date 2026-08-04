import path from 'node:path';
import { readdir, readFile } from 'node:fs/promises';
import { PackageError } from '../errors.js';
import { globToRegex, matchesGlob } from '../files/ignore.js';
import type {
  ManifestMonorepo,
  PackageConfig,
  WorkspacePackage,
  WorkspaceScope,
} from '../types.js';
import { toPosixPath } from '../util/path.js';

interface PackageJsonShape {
  name?: unknown;
  version?: unknown;
  private?: unknown;
  workspaces?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
}

export interface WorkspaceDiscovery {
  patterns: string[];
  sources: string[];
  workspaces: WorkspacePackage[];
}

const ignoredDirectoryNames = new Set([
  '.angular',
  '.cache',
  '.expo',
  '.git',
  '.hg',
  '.next',
  '.nuxt',
  '.nx',
  '.output',
  '.package-backups',
  '.parcel-cache',
  '.svelte-kit',
  '.svn',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
  'temp',
  'tmp',
]);

const commonWorkspacePatterns = [
  'packages/*',
  'apps/*',
  'services/*',
  'libs/*',
  'modules/*',
];

function parseJsonObject(
  content: string,
  source: string,
): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('must contain an object');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new PackageError(
      `Cannot parse workspace metadata ${source}: ${(error as Error).message}`,
      'WORKSPACE_METADATA_INVALID',
    );
  }
}

async function readOptionalFile(target: string): Promise<string | undefined> {
  try {
    return await readFile(target, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : [];
}

function packageWorkspacePatterns(value: unknown): string[] {
  if (Array.isArray(value)) return stringArray(value);
  if (!value || typeof value !== 'object') return [];
  return stringArray((value as { packages?: unknown }).packages);
}

function dependencyNames(value: PackageJsonShape): string[] {
  const names = new Set<string>();
  for (const field of [
    value.dependencies,
    value.devDependencies,
    value.peerDependencies,
    value.optionalDependencies,
  ]) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) continue;
    for (const name of Object.keys(field)) names.add(name);
  }
  return [...names].sort();
}

function parsePnpmWorkspacePatterns(content: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  let packagesIndent = 0;
  for (const rawLine of content.split(/\r?\n/)) {
    const commentless = rawLine.replace(/\s+#.*$/, '');
    const trimmed = commentless.trim();
    if (!trimmed) continue;
    const indent = commentless.length - commentless.trimStart().length;
    if (/^packages\s*:\s*$/.test(trimmed)) {
      inPackages = true;
      packagesIndent = indent;
      continue;
    }
    if (inPackages && indent <= packagesIndent && !trimmed.startsWith('-')) {
      inPackages = false;
    }
    if (!inPackages) continue;
    const match = trimmed.match(/^-\s*(.+)$/);
    if (!match) continue;
    const value = (match[1] ?? '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .trim();
    if (value) patterns.push(value);
  }
  return patterns;
}

function normalizePatterns(patterns: readonly string[]): string[] {
  const normalized = new Set<string>();
  for (const pattern of patterns) {
    const negated = pattern.startsWith('!');
    const value = toPosixPath(negated ? pattern.slice(1) : pattern)
      .replace(/^\.\//, '')
      .replace(/\/$/, '');
    if (!value || value === '.') continue;
    normalized.add(`${negated ? '!' : ''}${value}`);
  }
  return [...normalized];
}

function workspacePatternMatches(
  relativeDirectory: string,
  pattern: string,
): boolean {
  // Workspace declarations are rooted path patterns. A literal such as
  // "website" must match only that directory, not a nested package whose
  // path happens to contain a "website" segment. The generic ignore glob
  // matcher intentionally supports basename matching, so use its anchored
  // regex representation here instead.
  return globToRegex(pattern).test(relativeDirectory);
}

function matchesPatterns(
  relativeDirectory: string,
  patterns: string[],
): boolean {
  let selected = false;
  for (const rawPattern of patterns) {
    const negated = rawPattern.startsWith('!');
    const pattern = negated ? rawPattern.slice(1) : rawPattern;
    if (workspacePatternMatches(relativeDirectory, pattern))
      selected = !negated;
  }
  return selected;
}

async function scanPackageDirectories(root: string): Promise<string[]> {
  const directories: string[] = [];

  async function walk(
    directory: string,
    relativeDirectory: string,
  ): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    let hasPackageJson = false;
    for (const entry of entries) {
      if (entry.isFile() && entry.name === 'package.json') {
        hasPackageJson = true;
        break;
      }
    }
    if (relativeDirectory && hasPackageJson)
      directories.push(relativeDirectory);

    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredDirectoryNames.has(entry.name))
        continue;
      const childRelative = toPosixPath(
        path.posix.join(relativeDirectory, entry.name),
      );
      await walk(path.join(directory, entry.name), childRelative);
    }
  }

  await walk(root, '');
  return directories;
}

async function workspaceFromDirectory(
  root: string,
  relativeDirectory: string,
): Promise<WorkspacePackage> {
  const packagePath = path.join(
    root,
    ...relativeDirectory.split('/'),
    'package.json',
  );
  const raw = await readFile(packagePath, 'utf8');
  const parsed = parseJsonObject(raw, packagePath) as PackageJsonShape;
  const fallbackName = relativeDirectory.split('/').at(-1) ?? relativeDirectory;
  const name =
    typeof parsed.name === 'string' && parsed.name.trim().length > 0
      ? parsed.name.trim()
      : fallbackName;
  return {
    name,
    path: relativeDirectory,
    ...(typeof parsed.version === 'string' && parsed.version.length > 0
      ? { version: parsed.version }
      : {}),
    private: parsed.private === true,
    dependencies: dependencyNames(parsed),
  };
}

export async function discoverWorkspaces(
  config: PackageConfig,
): Promise<WorkspaceDiscovery> {
  if (config.monorepo.mode === 'off') {
    return { patterns: [], sources: [], workspaces: [] };
  }

  const patterns: string[] = [];
  const sources: string[] = [];
  const customPatterns = config.monorepo.workspacePatterns;

  const rootPackagePath = path.join(config.root, 'package.json');
  const rootPackage = await readOptionalFile(rootPackagePath);
  if (rootPackage) {
    const parsed = parseJsonObject(
      rootPackage,
      rootPackagePath,
    ) as PackageJsonShape;
    const packagePatterns = packageWorkspacePatterns(parsed.workspaces);
    if (packagePatterns.length > 0) {
      patterns.push(...packagePatterns);
      sources.push('package.json#workspaces');
    }
  }

  const pnpmPath = path.join(config.root, 'pnpm-workspace.yaml');
  const pnpm = await readOptionalFile(pnpmPath);
  if (pnpm) {
    const pnpmPatterns = parsePnpmWorkspacePatterns(pnpm);
    if (pnpmPatterns.length > 0) {
      patterns.push(...pnpmPatterns);
      sources.push('pnpm-workspace.yaml');
    }
  }

  const lernaPath = path.join(config.root, 'lerna.json');
  const lerna = await readOptionalFile(lernaPath);
  if (lerna) {
    const parsed = parseJsonObject(lerna, lernaPath);
    const lernaPatterns = stringArray(parsed.packages);
    patterns.push(
      ...(lernaPatterns.length > 0 ? lernaPatterns : ['packages/*']),
    );
    sources.push('lerna.json');
  }

  const rushPath = path.join(config.root, 'rush.json');
  const rush = await readOptionalFile(rushPath);
  if (rush) {
    const parsed = parseJsonObject(rush, rushPath);
    const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
    const rushPatterns = projects
      .map((project) =>
        project && typeof project === 'object'
          ? (project as { projectFolder?: unknown }).projectFolder
          : undefined,
      )
      .filter(
        (projectFolder): projectFolder is string =>
          typeof projectFolder === 'string' && projectFolder.length > 0,
      );
    if (rushPatterns.length > 0) {
      patterns.push(...rushPatterns);
      sources.push('rush.json');
    }
  }

  if (
    patterns.length === 0 &&
    customPatterns.length === 0 &&
    config.monorepo.mode === 'on'
  ) {
    patterns.push(...commonWorkspacePatterns);
    sources.push('common workspace directories');
  }
  if (customPatterns.length > 0) {
    patterns.push(...customPatterns);
    sources.push('.packagerc monorepo.workspacePatterns');
  }

  const normalizedPatterns = normalizePatterns(patterns);
  if (normalizedPatterns.length === 0) {
    return { patterns: [], sources, workspaces: [] };
  }

  const packageDirectories = await scanPackageDirectories(config.root);
  const selectedDirectories = packageDirectories.filter((directory) =>
    matchesPatterns(directory, normalizedPatterns),
  );
  const workspaces = await Promise.all(
    selectedDirectories.map((directory) =>
      workspaceFromDirectory(config.root, directory),
    ),
  );
  workspaces.sort(
    (left, right) =>
      left.path.localeCompare(right.path) ||
      left.name.localeCompare(right.name),
  );
  const names = new Map<string, string>();
  for (const workspace of workspaces) {
    const previous = names.get(workspace.name);
    if (previous) {
      throw new PackageError(
        `Duplicate workspace package name ${JSON.stringify(workspace.name)} in ${previous} and ${workspace.path}.`,
        'WORKSPACE_NAME_DUPLICATE',
      );
    }
    names.set(workspace.name, workspace.path);
  }
  return {
    patterns: normalizedPatterns,
    sources: [...new Set(sources)],
    workspaces,
  };
}

function selectorMatches(
  workspace: WorkspacePackage,
  selector: string,
): boolean {
  const normalized = toPosixPath(selector)
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
  if (
    workspace.name === normalized ||
    workspace.path === normalized ||
    path.posix.basename(workspace.path) === normalized
  ) {
    return true;
  }
  return (
    matchesGlob(workspace.name, normalized) ||
    matchesGlob(workspace.path, normalized)
  );
}

function expandWorkspaceGraph(
  selected: Set<string>,
  workspaces: WorkspacePackage[],
  includeDependencies: boolean,
  includeDependents: boolean,
): void {
  const byName = new Map(
    workspaces.map((workspace) => [workspace.name, workspace]),
  );
  const dependents = new Map<string, Set<string>>();
  for (const workspace of workspaces) {
    for (const dependency of workspace.dependencies) {
      if (!byName.has(dependency)) continue;
      const values = dependents.get(dependency) ?? new Set<string>();
      values.add(workspace.name);
      dependents.set(dependency, values);
    }
  }

  const queue = [...selected];
  while (queue.length > 0) {
    const name = queue.shift() as string;
    const workspace = byName.get(name);
    if (!workspace) continue;
    const related = new Set<string>();
    if (includeDependencies) {
      for (const dependency of workspace.dependencies) {
        if (byName.has(dependency)) related.add(dependency);
      }
    }
    if (includeDependents) {
      for (const dependent of dependents.get(name) ?? [])
        related.add(dependent);
    }
    for (const candidate of related) {
      if (selected.has(candidate)) continue;
      selected.add(candidate);
      queue.push(candidate);
    }
  }
}

function availableWorkspaceSummary(workspaces: WorkspacePackage[]): string {
  const shown = workspaces
    .slice(0, 8)
    .map((workspace) => `${workspace.name} (${workspace.path})`)
    .join(', ');
  const more =
    workspaces.length > 8 ? `, and ${workspaces.length - 8} more` : '';
  return shown ? `${shown}${more}` : 'none detected';
}

export async function resolveWorkspaceScope(
  config: PackageConfig,
  inherited?: ManifestMonorepo,
): Promise<WorkspaceScope | undefined> {
  const inheritedSelection =
    config.monorepo.selection.length === 0 && inherited !== undefined;
  const selectors = inheritedSelection
    ? inherited.workspaces.map((workspace) => workspace.path)
    : config.monorepo.selection;
  const includeRootFiles = inheritedSelection
    ? inherited.includeRootFiles
    : config.monorepo.includeRootFiles;
  if (selectors.length === 0) return undefined;
  if (config.monorepo.mode === 'off') {
    throw new PackageError(
      'Workspace selection was requested while monorepo support is disabled.',
      'MONOREPO_DISABLED',
    );
  }

  const discovery = await discoverWorkspaces(config);
  if (inheritedSelection && inherited) {
    const byPath = new Map(
      discovery.workspaces.map((workspace) => [workspace.path, workspace]),
    );
    return {
      patterns: discovery.patterns,
      sources: discovery.sources,
      workspaces: inherited.workspaces.map(
        (workspace) =>
          byPath.get(workspace.path) ?? {
            name: workspace.name,
            path: workspace.path,
            private: false,
            dependencies: [],
          },
      ),
      includeRootFiles,
    };
  }

  const candidates = [...discovery.workspaces];
  for (const workspace of inherited?.workspaces ?? []) {
    if (candidates.some((candidate) => candidate.path === workspace.path))
      continue;
    candidates.push({
      name: workspace.name,
      path: workspace.path,
      private: false,
      dependencies: [],
    });
  }
  if (candidates.length === 0) {
    throw new PackageError(
      'No monorepo workspaces were detected. Configure monorepo.workspacePatterns or use --workspace-pattern.',
      'WORKSPACES_NOT_FOUND',
    );
  }

  const selectedNames = new Set<string>();
  for (const selector of selectors) {
    const matches = candidates.filter((workspace) =>
      selectorMatches(workspace, selector),
    );
    if (matches.length === 0) {
      throw new PackageError(
        `Workspace selector ${JSON.stringify(selector)} did not match. Available workspaces: ${availableWorkspaceSummary(candidates)}.`,
        'WORKSPACE_NOT_FOUND',
      );
    }
    for (const workspace of matches) selectedNames.add(workspace.name);
  }

  expandWorkspaceGraph(
    selectedNames,
    discovery.workspaces,
    config.monorepo.includeDependencies,
    config.monorepo.includeDependents,
  );
  const workspaces = candidates
    .filter((workspace) => selectedNames.has(workspace.name))
    .sort((left, right) => left.path.localeCompare(right.path));
  return {
    patterns: discovery.patterns,
    sources: discovery.sources,
    workspaces,
    includeRootFiles,
  };
}

export function workspaceScopeMatchesManifest(
  scope: WorkspaceScope | undefined,
  manifest: ManifestMonorepo | undefined,
): boolean {
  if (!scope && !manifest) return true;
  if (!scope || !manifest) return false;
  if (scope.includeRootFiles !== manifest.includeRootFiles) return false;
  const current = scope.workspaces.map((workspace) => workspace.path).sort();
  const expected = manifest.workspaces
    .map((workspace) => workspace.path)
    .sort();
  return (
    current.length === expected.length &&
    current.every((workspace, index) => workspace === expected[index])
  );
}

export function pathMatchesWorkspaceScope(
  relativePath: string,
  config: PackageConfig,
  scope: WorkspaceScope | undefined,
): boolean {
  if (!scope) return true;
  if (
    scope.workspaces.some(
      (workspace) =>
        relativePath === workspace.path ||
        relativePath.startsWith(`${workspace.path}/`),
    )
  ) {
    return true;
  }
  return (
    scope.includeRootFiles &&
    config.monorepo.shared.some((pattern) => matchesGlob(relativePath, pattern))
  );
}

export function workspaceArchiveLabel(
  scope: WorkspaceScope | undefined,
  fallback: string,
): string {
  if (!scope) return fallback;
  if (scope.workspaces.length === 1) {
    const workspace = scope.workspaces[0] as WorkspacePackage;
    return path.posix.basename(workspace.path) || workspace.name;
  }
  return `${fallback}-${scope.workspaces.length}-workspaces`;
}

export function manifestMonorepo(
  scope: WorkspaceScope | undefined,
): ManifestMonorepo | undefined {
  if (!scope) return undefined;
  return {
    root: '.',
    workspaces: scope.workspaces.map((workspace) => ({
      name: workspace.name,
      path: workspace.path,
    })),
    includeRootFiles: scope.includeRootFiles,
  };
}
