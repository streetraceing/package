import path from 'node:path';
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises';
import type { ArchiveEntry, PackageConfig } from '../types.js';
import { collectFiles } from '../files/collect.js';
import { findSensitiveFiles } from '../files/sensitive.js';
import { createManifest } from '../manifest/create.js';
import { writeZip } from '../archive/zip.js';
import { PackageError } from '../errors.js';
import { parseShift } from '../shift/parser.js';
import { resolveInside } from '../util/path.js';
import { runPackageHooks } from '../util/hooks.js';
import {
  legacyPackageManifestPath,
  packageManifestPath,
  packageShiftPath,
} from '../archive/metadata.js';

export interface ZipCommandOptions {
  output?: string;
  quiet?: boolean;
}

export function defaultArchivePath(config: PackageConfig): string {
  const folder = path.basename(config.root);
  const fileName = config.name.replaceAll('{folder}', folder);
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
  const archivePath = options.output
    ? path.resolve(config.root, options.output)
    : defaultArchivePath(config);
  await mkdir(path.dirname(archivePath), { recursive: true });
  await runPackageHooks('beforePackage', config.beforePackage, {
    root: config.root,
    archivePath,
    command: 'zip',
    quiet: options.quiet,
  });
  const files = await collectFiles(config, archivePath);
  const sensitive = findSensitiveFiles(files.map((file) => file.relativePath));
  if (sensitive.length > 0 && config.sensitiveFiles === 'error') {
    throw new PackageError(
      `Sensitive files would be included:\n${sensitive.map((file) => `  ${file}`).join('\n')}`,
      'SENSITIVE_FILES',
    );
  }
  if (
    sensitive.length > 0 &&
    config.sensitiveFiles === 'warn' &&
    !options.quiet
  ) {
    console.warn(
      `Warning: potentially sensitive files are included:\n${sensitive.map((file) => `  ${file}`).join('\n')}`,
    );
  }
  const { manifest, data } = await createManifest(files, config, 'snapshot');
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
  await writeZip(archivePath, entries, {
    compressionLevel: config.compressionLevel,
    deterministic: config.deterministic,
  });
  await runPackageHooks('afterPackage', config.afterPackage, {
    root: config.root,
    archivePath,
    command: 'zip',
    quiet: options.quiet,
  });
  if (!options.quiet) {
    const bytes = entries.reduce((sum, entry) => sum + entry.data.length, 0);
    console.log(`Created ${archivePath}`);
    console.log(
      `${manifest.files.length} files, ${bytes.toLocaleString('en-US')} source bytes`,
    );
    if (manifest.rootHash) console.log(`Root ${manifest.rootHash}`);
  }
  return archivePath;
}
