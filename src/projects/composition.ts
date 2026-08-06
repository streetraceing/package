import path from 'node:path';
import { access, lstat, readFile, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import {
  configDirectoryOf,
  configPathOf,
  loadConfig,
  resolveConfigPaths,
} from '../config.js';
import { PackageError } from '../errors.js';
import type {
  ManifestComposition,
  PackageConfig,
  ProjectComposition,
  ProjectHookTarget,
  ProjectCompositionItem,
  ResolvedProject,
} from '../types.js';
import { normalizeRelativePath, toPosixPath } from '../util/path.js';

interface PackageJsonShape {
  name?: unknown;
}

interface ProjectDraft {
  name: string;
  root: string;
  configDirectory: string;
  configPath?: string;
  dependsOn: string[];
  config: PackageConfig;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function canonicalDirectory(target: string): Promise<string> {
  let stat;
  try {
    stat = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new PackageError(
        `Dependent project directory does not exist: ${target}`,
        'PROJECT_DEPENDENCY_NOT_FOUND',
      );
    }
    throw error;
  }
  if (!stat.isDirectory()) {
    throw new PackageError(
      `Dependent project path is not a directory: ${target}`,
      'PROJECT_DEPENDENCY_INVALID',
    );
  }
  return realpath(target);
}

async function packageName(root: string): Promise<string | undefined> {
  const target = path.join(root, 'package.json');
  try {
    const parsed = JSON.parse(
      await readFile(target, 'utf8'),
    ) as PackageJsonShape;
    return typeof parsed.name === 'string' && parsed.name.trim().length > 0
      ? parsed.name.trim()
      : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function localConfigPath(
  configDirectory: string,
): Promise<string | undefined> {
  for (const name of ['.packagerc', '.packagerc.json']) {
    const candidate = path.join(configDirectory, name);
    if (await exists(candidate)) return candidate;
  }
  return undefined;
}

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
}

function commonProjectRoot(roots: readonly string[]): string {
  let common = path.resolve(roots[0] as string);
  for (const root of roots.slice(1)) {
    const candidate = path.resolve(root);
    if (path.parse(common).root !== path.parse(candidate).root) {
      throw new PackageError(
        'Composed projects must be located on the same filesystem volume.',
        'PROJECTS_DIFFERENT_VOLUMES',
      );
    }
    while (!isInside(common, candidate)) {
      const parent = path.dirname(common);
      if (parent === common) break;
      common = parent;
    }
    if (!isInside(common, candidate)) {
      throw new PackageError(
        `Cannot determine a shared root for composed projects: ${roots.join(', ')}`,
        'PROJECT_ROOT_INVALID',
      );
    }
  }
  if (roots.length > 1 && common === path.parse(common).root) {
    throw new PackageError(
      'The shared root of composed projects cannot be the filesystem root. Move the projects under a common directory.',
      'PROJECT_ROOT_TOO_BROAD',
    );
  }
  return common;
}

function inferredName(root: string, discovered?: string): string {
  return discovered ?? path.basename(root);
}

async function dependencyProject(
  parent: ProjectDraft,
  dependencyPath: string,
  declaredName?: string,
): Promise<ProjectDraft> {
  const configDirectory = await canonicalDirectory(
    path.resolve(parent.configDirectory, dependencyPath),
  );
  const loaded = await loadConfig(configDirectory);
  const config = resolveConfigPaths(
    loaded.config,
    loaded.configDirectory,
    loaded.configPath,
  );
  const root = await canonicalDirectory(config.root);
  const discovered = await packageName(root);
  return {
    name: declaredName ?? inferredName(root, discovered),
    root,
    configDirectory,
    ...(loaded.configPath ? { configPath: loaded.configPath } : {}),
    dependsOn: [],
    config,
  };
}

async function entryProject(config: PackageConfig): Promise<ProjectDraft> {
  const root = await canonicalDirectory(config.root);
  const configDirectory = configDirectoryOf(config);
  const discovered = await packageName(root);
  const configPath =
    configPathOf(config) ?? (await localConfigPath(configDirectory));
  return {
    name: inferredName(root, discovered),
    root,
    configDirectory,
    ...(configPath ? { configPath } : {}),
    dependsOn: [],
    config: { ...config, root },
  };
}

function cycleDescription(
  stack: readonly ProjectDraft[],
  repeated: string,
): string {
  const start = stack.findIndex((project) => project.root === repeated);
  const cycle = [
    ...stack.slice(Math.max(0, start)).map((project) => project.name),
  ];
  cycle.push(cycle[0] ?? path.basename(repeated));
  return cycle.join(' -> ');
}

export async function resolveProjectComposition(
  config: PackageConfig,
): Promise<ProjectComposition | undefined> {
  if (config.depends_on.length === 0) return undefined;
  if (config.monorepo.selection.length > 0) {
    throw new PackageError(
      'depends_on project composition cannot be combined with monorepo.selection or --workspace. Use local depends_on declarations instead.',
      'PROJECT_COMPOSITION_MONOREPO_CONFLICT',
    );
  }

  const entry = await entryProject(config);
  const byRoot = new Map<string, ProjectDraft>();
  const byName = new Map<string, string>();
  const visiting: ProjectDraft[] = [];
  const ordered: ProjectDraft[] = [];

  async function visit(project: ProjectDraft): Promise<ProjectDraft> {
    if (project.config.monorepo.selection.length > 0) {
      throw new PackageError(
        `${project.name} uses both depends_on and monorepo.selection. A composed project must own one complete project tree; remove the workspace selection from its .packagerc.`,
        'PROJECT_COMPOSITION_MONOREPO_CONFLICT',
      );
    }
    const active = visiting.find(
      (candidate) => candidate.root === project.root,
    );
    if (active) {
      throw new PackageError(
        `Circular depends_on chain detected: ${cycleDescription(visiting, project.root)}.`,
        'PROJECT_DEPENDENCY_CYCLE',
      );
    }

    const known = byRoot.get(project.root);
    if (known) {
      if (known.name !== project.name) {
        throw new PackageError(
          `The same project directory is declared with two names: ${known.name} and ${project.name} (${project.root}).`,
          'PROJECT_NAME_CONFLICT',
        );
      }
      return known;
    }

    const previousRoot = byName.get(project.name);
    if (previousRoot && previousRoot !== project.root) {
      throw new PackageError(
        `Duplicate composed project name ${JSON.stringify(project.name)} in ${previousRoot} and ${project.root}.`,
        'PROJECT_NAME_DUPLICATE',
      );
    }
    byName.set(project.name, project.root);
    visiting.push(project);

    const dependencyNames: string[] = [];
    for (const dependency of project.config.depends_on) {
      const child = await dependencyProject(
        project,
        dependency.path,
        dependency.name,
      );
      if (child.root === project.root) {
        throw new PackageError(
          `${project.name} depends_on points back to itself: ${dependency.path}.`,
          'PROJECT_DEPENDENCY_SELF',
        );
      }
      const resolved = await visit(child);
      if (!dependencyNames.includes(resolved.name))
        dependencyNames.push(resolved.name);
    }
    project.dependsOn = dependencyNames;
    visiting.pop();
    byRoot.set(project.root, project);
    ordered.push(project);
    return project;
  }

  await visit(entry);
  const root = commonProjectRoot(ordered.map((project) => project.root));
  const projects: ResolvedProject[] = ordered.map((project) => {
    const archivePathValue = toPosixPath(path.relative(root, project.root));
    const archivePath = archivePathValue || '.';
    const configPath = project.configPath
      ? toPosixPath(path.relative(root, project.configPath))
      : undefined;
    return {
      ...project,
      archivePath,
      ...(configPath ? { configPath } : {}),
    };
  });

  return {
    root,
    entry: entry.name,
    projects,
  };
}

export function manifestComposition(
  composition: ProjectComposition | undefined,
): ManifestComposition | undefined {
  if (!composition) return undefined;
  return {
    root: '.',
    entry: composition.entry,
    projects: composition.projects.map((project) => ({
      name: project.name,
      path: project.archivePath,
      ...(project.configPath ? { configPath: project.configPath } : {}),
      dependsOn: [...project.dependsOn],
    })),
  };
}

function normalizedManifestProjects(
  projects: readonly ProjectCompositionItem[],
): string[] {
  return projects
    .map((project) =>
      JSON.stringify({
        name: project.name,
        path: project.path,
        configPath: project.configPath ?? '',
        dependsOn: [...project.dependsOn].sort(),
      }),
    )
    .sort();
}

export function compositionMatchesManifest(
  composition: ProjectComposition | undefined,
  manifest: ManifestComposition | undefined,
): boolean {
  if (!composition && !manifest) return true;
  if (!composition || !manifest) return false;
  if (composition.entry !== manifest.entry) return false;
  const current = normalizedManifestProjects(
    manifestComposition(composition)?.projects ?? [],
  );
  const expected = normalizedManifestProjects(manifest.projects);
  return (
    current.length === expected.length &&
    current.every((value, index) => value === expected[index])
  );
}

export function projectHookTargets(
  composition: ProjectComposition | undefined,
  hook: 'beforePackage' | 'afterPackage' | 'beforeApply' | 'afterApply',
  fallbackConfig?: PackageConfig,
): ProjectHookTarget[] {
  if (!composition) {
    if (!fallbackConfig) return [];
    return [
      {
        name: path.basename(fallbackConfig.root),
        path: '.',
        root: fallbackConfig.root,
        scripts: [...fallbackConfig[hook]],
        packageManager: fallbackConfig.packageManager,
      },
    ];
  }
  return composition.projects.map((project) => ({
    name: project.name,
    path: project.archivePath,
    root: project.root,
    scripts: [...project.config[hook]],
    packageManager: project.config.packageManager,
  }));
}

export async function resolveCompositionAtTarget(
  targetRoot: string,
  manifest: ManifestComposition,
): Promise<ProjectComposition> {
  const entry = manifest.projects.find(
    (project) => project.name === manifest.entry,
  );
  if (!entry) {
    throw new PackageError(
      'Archive composition does not contain its entry project.',
      'MANIFEST_INVALID',
    );
  }
  const entryDirectory = path.resolve(
    targetRoot,
    ...(entry.path === '.' ? [] : normalizeRelativePath(entry.path).split('/')),
  );
  const loaded = await loadConfig(entryDirectory);
  const config = resolveConfigPaths(
    loaded.config,
    loaded.configDirectory,
    loaded.configPath,
  );
  const composition = await resolveProjectComposition(config);
  if (!composition || !compositionMatchesManifest(composition, manifest)) {
    throw new PackageError(
      'Local depends_on project graph does not match the archive. Run package projects from the entry project and create a new snapshot if the graph changed.',
      'PROJECT_COMPOSITION_MISMATCH',
    );
  }
  if (path.resolve(composition.root) !== path.resolve(targetRoot)) {
    throw new PackageError(
      `Archive composition resolves to ${composition.root}, but apply target is ${targetRoot}.`,
      'PROJECT_COMPOSITION_ROOT_MISMATCH',
    );
  }
  return composition;
}
