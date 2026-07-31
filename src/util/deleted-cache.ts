import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import {
  packageDataDirectory,
  projectStorageKey,
  isPathInside,
} from './storage.js';
import { sha256Buffer } from './hash.js';
import { formatBytes, info, warning } from './terminal.js';

export const largeDeletedCacheFileBytes = 10 * 1024 * 1024;
const cacheMetadataFile = '.packagecache.json';

export type DeletedCacheReason =
  | 'apply-change'
  | 'backup-restore'
  | 'replace-output-archive'
  | 'delete-applied-package'
  | 'delete-source-package'
  | 'replace-config'
  | 'replace-gitignore'
  | 'replace-metadata';

export interface DeletedCacheEntry {
  originalPath: string;
  displayPath: string;
  storedPath: string;
  reason: DeletedCacheReason;
  size: number;
  mode: number;
  sha256: string;
  cachedAt: string;
}

export interface DeletedCacheMetadata {
  schemaVersion: 1;
  id: string;
  project: string;
  projectRoot: string;
  command: 'zip' | 'shift' | 'apply' | 'backup-restore' | 'init' | 'metadata';
  createdAt: string;
  sourceArchive?: string;
  entries: DeletedCacheEntry[];
}

export interface DeletedCacheSummary {
  directory?: string;
  files: number;
  bytes: number;
}

function createCacheId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${timestamp}-${randomBytes(3).toString('hex')}`;
}

function safeSegment(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '') || 'file'
  );
}

export function projectDeletedCacheDirectory(root: string): string {
  return path.join(packageDataDirectory(), 'cache', projectStorageKey(root));
}

export class DeletedCacheSession {
  readonly id = createCacheId();
  readonly directory: string;
  private readonly metadata: DeletedCacheMetadata;
  private readonly cachedOriginalPaths = new Set<string>();
  private bytes = 0;

  constructor(
    readonly projectRoot: string,
    command: DeletedCacheMetadata['command'],
    sourceArchive?: string,
  ) {
    this.projectRoot = path.resolve(projectRoot);
    this.directory = path.join(
      projectDeletedCacheDirectory(projectRoot),
      this.id,
    );
    this.metadata = {
      schemaVersion: 1,
      id: this.id,
      project: path.basename(this.projectRoot),
      projectRoot: this.projectRoot,
      command,
      createdAt: new Date().toISOString(),
      ...(sourceArchive ? { sourceArchive: path.resolve(sourceArchive) } : {}),
      entries: [],
    };
  }

  get summary(): DeletedCacheSummary {
    return {
      ...(this.metadata.entries.length > 0
        ? { directory: this.directory }
        : {}),
      files: this.metadata.entries.length,
      bytes: this.bytes,
    };
  }

  private async persistMetadata(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(
      path.join(this.directory, cacheMetadataFile),
      `${JSON.stringify(this.metadata, null, 2)}\n`,
      'utf8',
    );
  }

  private storedRelativePath(
    absolutePath: string,
    displayPath: string,
  ): string {
    if (isPathInside(this.projectRoot, absolutePath)) {
      const relative = path
        .relative(this.projectRoot, absolutePath)
        .replaceAll('\\', '/');
      return path.posix.join(
        'files',
        'project',
        relative || safeSegment(displayPath),
      );
    }
    const digest = sha256Buffer(
      Buffer.from(path.resolve(absolutePath), 'utf8'),
    ).slice('sha256:'.length, 'sha256:'.length + 12);
    return path.posix.join(
      'files',
      'external',
      `${digest}-${safeSegment(path.basename(absolutePath) || displayPath)}`,
    );
  }

  private async cacheBuffer(
    data: Buffer,
    absolutePath: string,
    displayPath: string,
    reason: DeletedCacheReason,
    mode: number,
  ): Promise<void> {
    const resolved = path.resolve(absolutePath);
    if (this.cachedOriginalPaths.has(resolved)) return;
    if (isPathInside(packageDataDirectory(), resolved)) return;

    const storedPath = this.storedRelativePath(resolved, displayPath);
    const target = path.join(this.directory, ...storedPath.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    await chmod(target, mode & 0o777);

    if (data.length > largeDeletedCacheFileBytes) {
      warning(
        `caching a large deleted file (${formatBytes(data.length)}): ${displayPath}`,
      );
    }

    this.cachedOriginalPaths.add(resolved);
    this.bytes += data.length;
    this.metadata.entries.push({
      originalPath: resolved,
      displayPath,
      storedPath,
      reason,
      size: data.length,
      mode: mode & 0o777,
      sha256: sha256Buffer(data),
      cachedAt: new Date().toISOString(),
    });
    await this.persistMetadata();
  }

  private async cacheDirectory(
    directoryPath: string,
    displayPath: string,
    reason: DeletedCacheReason,
  ): Promise<void> {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const childPath = path.join(directoryPath, entry.name);
      const childDisplay = `${displayPath.replace(/[\\/]$/, '')}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await this.cacheDirectory(childPath, childDisplay, reason);
      } else if (entry.isFile()) {
        await this.cachePath(childPath, reason, childDisplay);
      }
    }
  }

  async cachePath(
    absolutePath: string,
    reason: DeletedCacheReason,
    displayPath = absolutePath,
  ): Promise<boolean> {
    const resolved = path.resolve(absolutePath);
    if (isPathInside(packageDataDirectory(), resolved)) return false;
    let stat;
    try {
      stat = await lstat(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    if (stat.isSymbolicLink()) return false;
    if (stat.isDirectory()) {
      await this.cacheDirectory(resolved, displayPath, reason);
      return true;
    }
    if (!stat.isFile()) return false;
    const data = await readFile(resolved);
    await this.cacheBuffer(data, resolved, displayPath, reason, stat.mode);
    return true;
  }
}

export function reportDeletedCache(
  session: DeletedCacheSession | undefined,
  quiet = false,
): void {
  if (!session || quiet) return;
  const summary = session.summary;
  if (!summary.directory || summary.files === 0) return;
  info(
    `Saved ${summary.files} deleted or replaced file${summary.files === 1 ? '' : 's'} (${formatBytes(summary.bytes)}) to ${summary.directory}`,
  );
}
