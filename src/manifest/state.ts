import { lstat, readFile } from 'node:fs/promises';
import { sha256Buffer, stableJson } from '../util/hash.js';
import { resolveInside } from '../util/path.js';
import type { ManifestFile } from '../types.js';

export async function readCurrentManifestFiles(root: string, referenceFiles: ManifestFile[]): Promise<ManifestFile[]> {
  const output: ManifestFile[] = [];
  for (const reference of referenceFiles) {
    const absolutePath = resolveInside(root, reference.path);
    try {
      const stat = await lstat(absolutePath);
      if (!stat.isFile()) continue;
      const data = await readFile(absolutePath);
      output.push({
        path: reference.path,
        size: data.length,
        mode: stat.mode & 0o777,
        ...(reference.mtime ? { mtime: stat.mtime.toISOString() } : {}),
        sha256: sha256Buffer(data),
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

export function rootHashForFiles(files: ManifestFile[]): string {
  return sha256Buffer(Buffer.from(stableJson(files), 'utf8'));
}
