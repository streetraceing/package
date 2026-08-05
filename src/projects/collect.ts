import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { PackageError } from '../errors.js';
import { collectProjectFiles } from '../files/collect.js';
import type {
  CollectedFile,
  PackageConfig,
  ProjectComposition,
} from '../types.js';
import { toPosixPath } from '../util/path.js';
import { resolveProjectComposition } from './composition.js';

export interface ProjectFileGroup {
  name: string;
  path: string;
  config: PackageConfig;
  files: CollectedFile[];
}

export interface ProjectCollection {
  files: CollectedFile[];
  groups: ProjectFileGroup[];
  composition?: ProjectComposition;
}

function archivePath(projectPath: string, relativePath: string): string {
  return projectPath === '.'
    ? relativePath
    : toPosixPath(path.posix.join(projectPath, relativePath));
}

async function localConfigFile(
  composition: ProjectComposition,
  project: ProjectComposition['projects'][number],
  config: PackageConfig,
): Promise<CollectedFile | undefined> {
  if (!project.configPath) return undefined;
  const relativePath = toPosixPath(project.configPath);
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('../') ||
    path.isAbsolute(relativePath)
  ) {
    throw new PackageError(
      `Project config is outside the composition root: ${project.configPath}`,
      'PROJECT_CONFIG_OUTSIDE_ROOT',
    );
  }
  const absolutePath = path.resolve(
    composition.root,
    ...relativePath.split('/'),
  );
  const stat = await lstat(absolutePath);
  if (!stat.isFile()) {
    throw new PackageError(
      `Project config is not a regular file: ${absolutePath}`,
      'PROJECT_CONFIG_INVALID',
    );
  }
  return {
    absolutePath,
    relativePath,
    size: stat.size,
    mode: stat.mode & 0o777,
    mtime: stat.mtime,
    preserveMode: config.preserveMode,
    preserveMtime: config.preserveMtime,
    projectName: project.name,
  };
}

export async function collectConfiguredProjects(
  config: PackageConfig,
  outputArchive?: string,
  resolvedComposition?: ProjectComposition,
): Promise<ProjectCollection> {
  const composition =
    resolvedComposition ?? (await resolveProjectComposition(config));
  if (!composition) {
    const { files } = await collectProjectFiles(config, outputArchive);
    return {
      files,
      groups: [
        {
          name: path.basename(config.root),
          path: '.',
          config,
          files,
        },
      ],
    };
  }

  const groups: ProjectFileGroup[] = [];
  const allFiles = new Map<string, CollectedFile>();
  for (const project of composition.projects) {
    const projectConfig =
      project.name === composition.entry ? config : project.config;
    const { files } = await collectProjectFiles(projectConfig, outputArchive);
    const mapped: CollectedFile[] = files.map((file) => ({
      ...file,
      relativePath: archivePath(project.archivePath, file.relativePath),
      preserveMode: projectConfig.preserveMode,
      preserveMtime: projectConfig.preserveMtime,
      projectName: project.name,
    }));
    const configFile = await localConfigFile(
      composition,
      project,
      projectConfig,
    );
    if (
      configFile &&
      !mapped.some((file) => file.relativePath === configFile.relativePath)
    ) {
      mapped.push(configFile);
    }
    for (const file of mapped) {
      const existing = allFiles.get(file.relativePath);
      if (existing) {
        throw new PackageError(
          `Composed projects produce the same archive path ${file.relativePath}: ${existing.projectName ?? 'project'} and ${project.name}. Adjust include/ignore rules or project roots.`,
          'PROJECT_ARCHIVE_PATH_CONFLICT',
        );
      }
      allFiles.set(file.relativePath, file);
    }
    groups.push({
      name: project.name,
      path: project.archivePath,
      config: projectConfig,
      files: mapped,
    });
  }

  return {
    files: [...allFiles.values()].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    ),
    groups,
    composition,
  };
}
