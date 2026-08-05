import path from 'node:path';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import type { ArchiveEntry, PackageConfig, WorkspaceScope } from '../types.js';
import { collectConfiguredProjects } from '../projects/collect.js';
import { findSensitiveFiles } from '../files/sensitive.js';
import { createManifest } from '../manifest/create.js';
import { writeZip } from '../archive/zip.js';
import { PackageError } from '../errors.js';
import { parseShift } from '../shift/parser.js';
import { resolveInside } from '../util/path.js';
import { runProjectHookTargets } from '../util/hooks.js';
import {
  DeletedCacheSession,
  reportDeletedCache,
} from '../util/deleted-cache.js';
import {
  color,
  divider,
  label,
  section,
  success,
  symbol,
  warning,
} from '../util/terminal.js';
import {
  legacyPackageManifestPath,
  packageManifestPath,
  packageShiftPath,
} from '../archive/metadata.js';
import {
  resolveWorkspaceScope,
  workspaceArchiveLabel,
} from '../workspaces/discover.js';
import {
  projectHookTargets,
  resolveProjectComposition,
} from '../projects/composition.js';

export interface ZipCommandOptions {
  output?: string;
  quiet?: boolean;
}

function safeArchiveLabel(value: string): string {
  return (
    value
      .replace(/^@/, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'workspace'
  );
}

export function defaultArchivePath(
  config: PackageConfig,
  workspaceScope?: WorkspaceScope,
): string {
  const folder = path.basename(config.root);
  const workspaceLabel = safeArchiveLabel(
    workspaceArchiveLabel(workspaceScope, folder),
  );
  const fileName =
    workspaceScope && config.name === '{folder}.zip'
      ? `${workspaceLabel}.zip`
      : config.name
          .replaceAll('{folder}', folder)
          .replaceAll('{workspace}', workspaceLabel)
          .replaceAll('{workspaces}', workspaceLabel);
  return path.resolve(config.output, fileName);
}

async function readConfiguredShiftEntry(
  config: PackageConfig,
): Promise<ArchiveEntry | undefined> {
  const configuredPath = config.shiftFile
    .replaceAll('\\', '/')
    .replace(/^\.\//, '');
  if (
    configuredPath === packageManifestPath ||
    configuredPath === legacyPackageManifestPath
  ) {
    throw new PackageError(
      `shiftFile cannot use the reserved manifest path: ${config.shiftFile}`,
      'CONFIG_INVALID',
    );
  }

  let target = resolveInside(config.root, config.shiftFile);
  let stat;
  try {
    stat = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }

  if (stat.isSymbolicLink()) {
    if (!config.followSymlinks) {
      throw new PackageError(
        `Configured shift file is a symbolic link: ${config.shiftFile}`,
        'SYMLINK_NOT_ALLOWED',
      );
    }
    target = await realpath(target);
    const relation = path.relative(config.root, target);
    if (relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new PackageError(
        `Configured shift file points outside the project: ${config.shiftFile}`,
        'SYMLINK_OUTSIDE_ROOT',
      );
    }
    stat = await lstat(target);
  }

  if (!stat.isFile()) {
    throw new PackageError(
      `Configured shift file is not a regular file: ${config.shiftFile}`,
      'SHIFT_FILE_INVALID',
    );
  }

  const data = await readFile(target);
  parseShift(data.toString('utf8'), config.shiftFile);
  return {
    path: packageShiftPath,
    data,
    mode: config.preserveMode ? stat.mode & 0o777 : 0o644,
  };
}

export async function createSnapshot(
  config: PackageConfig,
  options: ZipCommandOptions = {},
): Promise<string> {
  const composition = await resolveProjectComposition(config);
  const workspaceScope = composition
    ? undefined
    : await resolveWorkspaceScope(config);
  const archivePath = options.output
    ? path.resolve(config.root, options.output)
    : defaultArchivePath(config, workspaceScope);
  await mkdir(path.dirname(archivePath), { recursive: true });

  const beforeTargets = projectHookTargets(
    composition,
    'beforePackage',
    config,
  );
  await runProjectHookTargets('beforePackage', beforeTargets, {
    archivePath,
    command: 'zip',
    quiet: options.quiet,
    compositionRoot: composition?.root ?? config.root,
  });

  const collection = composition
    ? await collectConfiguredProjects(config, archivePath, composition)
    : await collectConfiguredProjects(config, archivePath);
  const { files } = collection;

  for (const group of collection.groups) {
    const sensitive = findSensitiveFiles(
      group.files.map((file) =>
        group.path === '.'
          ? file.relativePath
          : file.relativePath.slice(group.path.length + 1),
      ),
    );
    if (sensitive.length > 0 && group.config.sensitiveFiles === 'error') {
      throw new PackageError(
        `Sensitive files would be included from ${group.name}:\n${sensitive.map((file) => `  ${file}`).join('\n')}`,
        'SENSITIVE_FILES',
      );
    }
    if (
      sensitive.length > 0 &&
      group.config.sensitiveFiles === 'warn' &&
      !options.quiet
    ) {
      warning(
        `potentially sensitive files are included from ${group.name}:\n${sensitive.map((file) => `  ${file}`).join('\n')}`,
      );
    }
  }

  const { manifest, data } = await createManifest(
    files,
    config,
    'snapshot',
    undefined,
    undefined,
    workspaceScope,
    composition,
  );
  const entries: ArchiveEntry[] = [];
  for (const file of manifest.files) {
    const content = data.get(file.path);
    if (!content)
      throw new PackageError(
        `Cannot read collected file: ${file.path}`,
        'FILE_READ_ERROR',
      );
    entries.push({
      path: file.path,
      data: content,
      mode: file.mode,
      mtime: file.mtime ? new Date(file.mtime) : undefined,
    });
  }
  entries.push({
    path: packageManifestPath,
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    mode: 0o644,
    compression: 'deflate',
  });
  const shiftEntry = await readConfiguredShiftEntry(config);
  if (shiftEntry) entries.push(shiftEntry);
  const deletedCache = config.saveDeletedCache
    ? new DeletedCacheSession(config.root, 'zip', archivePath)
    : undefined;
  if (deletedCache)
    await deletedCache.cachePath(
      archivePath,
      'replace-output-archive',
      path.basename(archivePath),
    );
  await writeZip(archivePath, entries, {
    compressionLevel: config.compressionLevel,
    deterministic: config.deterministic,
  });
  reportDeletedCache(deletedCache, options.quiet);

  const afterTargets = projectHookTargets(composition, 'afterPackage', config);
  await runProjectHookTargets('afterPackage', afterTargets, {
    archivePath,
    command: 'zip',
    quiet: options.quiet,
    compositionRoot: composition?.root ?? config.root,
  });

  if (!options.quiet) {
    const bytes = entries.reduce((sum, entry) => sum + entry.data.length, 0);
    section('Snapshot created');
    success(`Created ${archivePath}`);
    console.log(
      `${color.muted(symbol.branch)} ${label('Files')} ${color.green(manifest.files.length.toLocaleString('en-US'))}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Source bytes')} ${color.blue(bytes.toLocaleString('en-US'))}`,
    );
    if (composition)
      console.log(
        `${color.muted(symbol.branch)} ${label('Projects')} ${color.magenta(
          composition.projects
            .map((project) => `${project.name} (${project.archivePath})`)
            .join(', '),
        )}`,
      );
    if (workspaceScope)
      console.log(
        `${color.muted(symbol.branch)} ${label('Workspaces')} ${color.magenta(
          workspaceScope.workspaces
            .map((workspace) => workspace.name)
            .join(', '),
        )}`,
      );
    if (manifest.rootHash)
      console.log(
        `${color.muted(symbol.branch)} ${label('Root')} ${color.cyan(manifest.rootHash)}`,
      );
    console.log(color.muted(divider(44)));
  }
  return archivePath;
}
