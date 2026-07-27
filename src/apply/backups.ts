import path from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { ArchiveEntry } from '../types.js';
import { PackageError } from '../errors.js';
import { readZip, writeZip } from '../archive/zip.js';
import { assertNoSymlinkAncestors, resolveInside } from '../util/path.js';
import { sha256Buffer, sha256File } from '../util/hash.js';

const backupMetadataPath = '.packagebackup.json';

export interface BackupItem {
  path: string;
  existed: boolean;
  data?: Buffer;
  mode?: number;
}

interface BackupPathMetadata {
  path: string;
  existed: boolean;
  mode?: number;
  sha256?: string;
}

export interface BackupMetadata {
  schemaVersion: 1;
  id: string;
  kind: 'apply' | 'rollback';
  project: string;
  projectRoot: string;
  createdAt: string;
  sourceArchive?: {
    name: string;
    sha256?: string;
  };
  restores?: string[];
  paths: BackupPathMetadata[];
}

export interface BackupVersion {
  id: string;
  archivePath: string;
  metadata: BackupMetadata;
  legacy: boolean;
}

export interface PersistBackupOptions {
  kind?: BackupMetadata['kind'];
  sourceArchivePath?: string;
  restores?: string[];
}

function normalizedProjectRoot(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function projectKey(root: string): string {
  const name =
    path
      .basename(path.resolve(root))
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
  const digest = sha256Buffer(
    Buffer.from(normalizedProjectRoot(root), 'utf8'),
  ).slice('sha256:'.length, 'sha256:'.length + 12);
  return `${name}-${digest}`;
}

export function packageDataDirectory(): string {
  const override = process.env.STREETRACEING_PACKAGE_HOME;
  return override
    ? path.resolve(override)
    : path.join(homedir(), 'streetraceing', '.package');
}

export function projectBackupDirectory(root: string): string {
  return path.join(packageDataDirectory(), 'backups', projectKey(root));
}

async function existingFile(
  root: string,
  relativePath: string,
): Promise<{ data: Buffer; mode: number } | undefined> {
  const absolutePath = resolveInside(root, relativePath);
  try {
    const fileStat = await lstat(absolutePath);
    if (fileStat.isSymbolicLink())
      throw new PackageError(
        `Refusing to back up symbolic link: ${relativePath}`,
        'SYMLINK_PATH',
      );
    if (!fileStat.isFile())
      throw new PackageError(
        `Expected a regular file: ${relativePath}`,
        'NOT_A_FILE',
      );
    return { data: await readFile(absolutePath), mode: fileStat.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function captureBackup(
  root: string,
  paths: string[],
): Promise<BackupItem[]> {
  const backup: BackupItem[] = [];
  for (const relativePath of [...new Set(paths)].sort()) {
    const current = await existingFile(root, relativePath);
    backup.push(
      current
        ? {
            path: relativePath,
            existed: true,
            data: current.data,
            mode: current.mode,
          }
        : { path: relativePath, existed: false },
    );
  }
  return backup;
}

export async function restoreBackupItems(
  root: string,
  backup: BackupItem[],
): Promise<void> {
  for (const item of [...backup].reverse()) {
    await assertNoSymlinkAncestors(root, item.path);
    const absolutePath = resolveInside(root, item.path);
    if (!item.existed) {
      await rm(absolutePath, { force: true, recursive: true });
      continue;
    }
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, item.data as Buffer);
    await chmod(absolutePath, item.mode ?? 0o644);
  }
}

function createBackupId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-${randomBytes(3).toString('hex')}`;
}

export async function persistBackup(
  root: string,
  backup: BackupItem[],
  options: PersistBackupOptions = {},
): Promise<string> {
  const id = createBackupId();
  const backupPath = path.join(projectBackupDirectory(root), `${id}.zip`);
  await mkdir(path.dirname(backupPath), { recursive: true });

  let sourceArchive: BackupMetadata['sourceArchive'];
  if (options.sourceArchivePath) {
    try {
      sourceArchive = {
        name: path.basename(options.sourceArchivePath),
        sha256: await sha256File(options.sourceArchivePath),
      };
    } catch {
      sourceArchive = { name: path.basename(options.sourceArchivePath) };
    }
  }

  const metadata: BackupMetadata = {
    schemaVersion: 1,
    id,
    kind: options.kind ?? 'apply',
    project: path.basename(path.resolve(root)),
    projectRoot: path.resolve(root),
    createdAt: new Date().toISOString(),
    ...(sourceArchive ? { sourceArchive } : {}),
    ...(options.restores && options.restores.length > 0
      ? { restores: options.restores }
      : {}),
    paths: backup.map((item) => ({
      path: item.path,
      existed: item.existed,
      ...(item.mode !== undefined ? { mode: item.mode } : {}),
      ...(item.data ? { sha256: sha256Buffer(item.data) } : {}),
    })),
  };

  const entries: ArchiveEntry[] = backup
    .filter(
      (item): item is BackupItem & { data: Buffer } =>
        item.existed && item.data !== undefined,
    )
    .map((item) => ({
      path: item.path,
      data: item.data,
      mode: item.mode ?? 0o644,
    }));
  entries.push({
    path: backupMetadataPath,
    data: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'),
    mode: 0o600,
  });
  await writeZip(backupPath, entries, {
    compressionLevel: 9,
    deterministic: false,
  });
  return backupPath;
}

function validatePathMetadata(
  value: unknown,
  sourcePath: string,
): BackupPathMetadata[] {
  if (!Array.isArray(value))
    throw new PackageError(
      `${sourcePath} backup metadata must contain a paths array.`,
      'BACKUP_INVALID',
    );
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      throw new PackageError(
        `${sourcePath} contains invalid backup path metadata.`,
        'BACKUP_INVALID',
      );
    const item = entry as Record<string, unknown>;
    if (typeof item.path !== 'string' || typeof item.existed !== 'boolean')
      throw new PackageError(
        `${sourcePath} contains invalid backup path metadata.`,
        'BACKUP_INVALID',
      );
    if (item.mode !== undefined && typeof item.mode !== 'number')
      throw new PackageError(
        `${sourcePath} contains an invalid backup mode.`,
        'BACKUP_INVALID',
      );
    if (item.sha256 !== undefined && typeof item.sha256 !== 'string')
      throw new PackageError(
        `${sourcePath} contains an invalid backup hash.`,
        'BACKUP_INVALID',
      );
    return {
      path: item.path,
      existed: item.existed,
      ...(typeof item.mode === 'number' ? { mode: item.mode } : {}),
      ...(typeof item.sha256 === 'string' ? { sha256: item.sha256 } : {}),
    };
  });
}

async function readBackupVersion(
  archivePath: string,
  root: string,
  legacy: boolean,
): Promise<BackupVersion> {
  const entries = await readZip(archivePath);
  const metadataEntry = entries.get(backupMetadataPath);
  if (!metadataEntry)
    throw new PackageError(
      `Backup archive is missing ${backupMetadataPath}: ${archivePath}`,
      'BACKUP_INVALID',
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataEntry.data.toString('utf8'));
  } catch (error) {
    throw new PackageError(
      `Cannot parse backup metadata in ${archivePath}: ${(error as Error).message}`,
      'BACKUP_INVALID',
    );
  }

  if (Array.isArray(parsed)) {
    const fileStat = await stat(archivePath);
    const id = path.basename(archivePath, path.extname(archivePath));
    return {
      id,
      archivePath,
      legacy: true,
      metadata: {
        schemaVersion: 1,
        id,
        kind: 'apply',
        project: path.basename(path.resolve(root)),
        projectRoot: path.resolve(root),
        createdAt: fileStat.mtime.toISOString(),
        paths: validatePathMetadata(parsed, archivePath),
      },
    };
  }

  if (!parsed || typeof parsed !== 'object')
    throw new PackageError(
      `Backup metadata must be an object: ${archivePath}`,
      'BACKUP_INVALID',
    );
  const value = parsed as Record<string, unknown>;
  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    (value.kind !== 'apply' && value.kind !== 'rollback') ||
    typeof value.project !== 'string' ||
    typeof value.projectRoot !== 'string' ||
    typeof value.createdAt !== 'string'
  ) {
    throw new PackageError(
      `Backup metadata is invalid: ${archivePath}`,
      'BACKUP_INVALID',
    );
  }
  let sourceArchive: BackupMetadata['sourceArchive'];
  if (value.sourceArchive !== undefined) {
    if (
      !value.sourceArchive ||
      typeof value.sourceArchive !== 'object' ||
      Array.isArray(value.sourceArchive)
    )
      throw new PackageError(
        `Backup source archive metadata is invalid: ${archivePath}`,
        'BACKUP_INVALID',
      );
    const source = value.sourceArchive as Record<string, unknown>;
    if (
      typeof source.name !== 'string' ||
      (source.sha256 !== undefined && typeof source.sha256 !== 'string')
    )
      throw new PackageError(
        `Backup source archive metadata is invalid: ${archivePath}`,
        'BACKUP_INVALID',
      );
    sourceArchive = {
      name: source.name,
      ...(typeof source.sha256 === 'string' ? { sha256: source.sha256 } : {}),
    };
  }
  const restores = Array.isArray(value.restores)
    ? value.restores.filter((item): item is string => typeof item === 'string')
    : undefined;
  const metadata: BackupMetadata = {
    schemaVersion: 1,
    id: value.id,
    kind: value.kind,
    project: value.project,
    projectRoot: value.projectRoot,
    createdAt: value.createdAt,
    ...(sourceArchive ? { sourceArchive } : {}),
    ...(restores && restores.length > 0 ? { restores } : {}),
    paths: validatePathMetadata(value.paths, archivePath),
  };
  return {
    id: metadata.id,
    archivePath,
    metadata,
    legacy,
  };
}

async function zipFiles(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.zip'))
      .map((entry) => path.join(directory, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function listBackupVersions(
  root: string,
): Promise<BackupVersion[]> {
  const globalPaths = await zipFiles(projectBackupDirectory(root));
  const legacyPaths = await zipFiles(
    path.join(path.resolve(root), '.package-backups'),
  );
  const versions: BackupVersion[] = [];
  for (const archivePath of globalPaths) {
    try {
      versions.push(await readBackupVersion(archivePath, root, false));
    } catch (error) {
      console.warn(`Warning: ${(error as Error).message}`);
    }
  }
  for (const archivePath of legacyPaths) {
    try {
      versions.push(await readBackupVersion(archivePath, root, true));
    } catch (error) {
      console.warn(`Warning: ${(error as Error).message}`);
    }
  }
  return versions.sort((left, right) =>
    right.metadata.createdAt.localeCompare(left.metadata.createdAt),
  );
}

export function selectBackupVersion(
  versions: BackupVersion[],
  selector: string,
): { version: BackupVersion; index: number } {
  if (versions.length === 0)
    throw new PackageError(
      'No backups found for this project.',
      'BACKUP_MISSING',
    );
  if (selector === 'latest')
    return { version: versions[0] as BackupVersion, index: 0 };
  if (/^[1-9][0-9]*$/.test(selector)) {
    const index = Number(selector) - 1;
    const version = versions[index];
    if (version) return { version, index };
  }
  const matches = versions.filter(
    (version) =>
      version.id === selector ||
      version.id.startsWith(selector) ||
      path.basename(version.archivePath, '.zip').startsWith(selector),
  );
  if (matches.length === 1) {
    const version = matches[0] as BackupVersion;
    return { version, index: versions.indexOf(version) };
  }
  if (matches.length > 1)
    throw new PackageError(
      `Backup selector is ambiguous: ${selector}`,
      'BACKUP_AMBIGUOUS',
    );
  throw new PackageError(`Backup not found: ${selector}`, 'BACKUP_MISSING');
}

export async function loadBackupItems(
  version: BackupVersion,
): Promise<BackupItem[]> {
  const entries = await readZip(version.archivePath);
  const items: BackupItem[] = [];
  for (const metadata of version.metadata.paths) {
    if (!metadata.existed) {
      items.push({ path: metadata.path, existed: false });
      continue;
    }
    const entry = entries.get(metadata.path);
    if (!entry)
      throw new PackageError(
        `Backup payload is missing: ${metadata.path}`,
        'BACKUP_INVALID',
      );
    if (metadata.sha256 && sha256Buffer(entry.data) !== metadata.sha256)
      throw new PackageError(
        `Backup payload failed integrity check: ${metadata.path}`,
        'BACKUP_INVALID',
      );
    items.push({
      path: metadata.path,
      existed: true,
      data: entry.data,
      mode: metadata.mode ?? entry.mode,
    });
  }
  return items;
}

async function confirmRestore(
  backupCount: number,
  pathCount: number,
  yes: boolean,
): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new PackageError(
      'Refusing to restore a backup without confirmation in a non-interactive shell. Pass --yes.',
      'CONFIRMATION_REQUIRED',
    );
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(
      `Restore ${backupCount} backup version${backupCount === 1 ? '' : 's'} across ${pathCount} paths? [y/N] `,
    );
    return ['y', 'yes'].includes(answer.trim().toLowerCase());
  } finally {
    readline.close();
  }
}

export async function restoreBackupVersion(
  root: string,
  selector: string,
  yes: boolean,
): Promise<{
  selected: BackupVersion;
  restoredVersions: BackupVersion[];
  recoveryBackupPath: string;
  changedPaths: number;
}> {
  const versions = await listBackupVersions(root);
  const { version: selected, index } = selectBackupVersion(versions, selector);
  const chain = versions.slice(0, index + 1);
  const pathSet = new Set<string>();
  for (const version of chain)
    for (const item of version.metadata.paths) pathSet.add(item.path);
  const paths = [...pathSet].sort();
  for (const relativePath of paths) {
    resolveInside(root, relativePath);
    await assertNoSymlinkAncestors(root, relativePath);
  }
  if (!(await confirmRestore(chain.length, paths.length, yes)))
    throw new PackageError('Backup restore cancelled.', 'BACKUP_CANCELLED');

  const recovery = await captureBackup(root, paths);
  const recoveryBackupPath = await persistBackup(root, recovery, {
    kind: 'rollback',
    restores: chain.map((version) => version.id),
  });
  try {
    for (const version of chain) {
      const items = await loadBackupItems(version);
      await restoreBackupItems(root, items);
    }
  } catch (error) {
    await restoreBackupItems(root, recovery);
    await rm(recoveryBackupPath, { force: true });
    throw new PackageError(
      `Backup restore failed and the project was returned to its previous state: ${(error as Error).message}`,
      'BACKUP_ROLLBACK',
    );
  }
  return {
    selected,
    restoredVersions: chain,
    recoveryBackupPath,
    changedPaths: paths.length,
  };
}
