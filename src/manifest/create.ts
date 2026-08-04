import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { sha256Buffer, stableJson } from '../util/hash.js';
import { isReservedPackageMetadataPath } from '../archive/metadata.js';
import type {
  CollectedFile,
  ManifestFile,
  PackageConfig,
  PackageManifest,
  WorkspaceScope,
} from '../types.js';
import { manifestMonorepo } from '../workspaces/discover.js';

export async function createManifest(
  files: CollectedFile[],
  config: PackageConfig,
  kind: PackageManifest['kind'] = 'snapshot',
  baseRootHash?: string,
  baseFiles?: ManifestFile[],
  workspaceScope?: WorkspaceScope,
): Promise<{ manifest: PackageManifest; data: Map<string, Buffer> }> {
  const manifestFiles: ManifestFile[] = [];
  const data = new Map<string, Buffer>();
  for (const file of files) {
    if (isReservedPackageMetadataPath(file.relativePath)) continue;
    const content = await readFile(file.absolutePath);
    data.set(file.relativePath, content);
    manifestFiles.push({
      path: file.relativePath,
      size: content.length,
      mode: config.preserveMode ? file.mode : 0o644,
      ...(config.preserveMtime ? { mtime: file.mtime.toISOString() } : {}),
      sha256: sha256Buffer(content),
    });
  }
  manifestFiles.sort((left, right) => left.path.localeCompare(right.path));
  const rootHash = sha256Buffer(Buffer.from(stableJson(manifestFiles), 'utf8'));
  const manifest: PackageManifest = {
    schemaVersion: 1,
    kind,
    project: path.basename(config.root),
    createdAt: new Date().toISOString(),
    rootHash,
    ...(baseRootHash ? { baseRootHash } : {}),
    ...(baseFiles ? { baseFiles } : {}),
    ...(manifestMonorepo(workspaceScope)
      ? { monorepo: manifestMonorepo(workspaceScope) }
      : {}),
    config: {
      strategy: config.strategy,
      gitignore: config.gitignore,
      npmignore: config.npmignore,
      dot: config.dot,
    },
    files: manifestFiles,
  };
  return { manifest, data };
}
