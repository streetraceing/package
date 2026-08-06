import type { ArchiveEntry, PackageManifest } from '../types.js';
import { PackageError } from '../errors.js';
import { packageManifestPath, packageShiftPath } from './metadata.js';

export function payloadArchiveEntries(
  manifest: PackageManifest,
  data: ReadonlyMap<string, Buffer>,
): ArchiveEntry[] {
  return manifest.files.map((file) => {
    const content = data.get(file.path);
    if (!content)
      throw new PackageError(
        `Cannot read collected file: ${file.path}`,
        'FILE_READ_ERROR',
      );
    return {
      path: file.path,
      data: content,
      mode: file.mode,
      mtime: file.mtime ? new Date(file.mtime) : undefined,
    };
  });
}

export function manifestArchiveEntry(manifest: PackageManifest): ArchiveEntry {
  return {
    path: packageManifestPath,
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    mode: 0o644,
    compression: 'deflate',
  };
}

export function shiftArchiveEntry(content: string | Buffer): ArchiveEntry {
  return {
    path: packageShiftPath,
    data: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
    mode: 0o644,
    compression: 'deflate',
  };
}
