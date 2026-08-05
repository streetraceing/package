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
  ProjectComposition,
} from '../types.js';
import { manifestMonorepo } from '../workspaces/discover.js';
import { manifestComposition } from '../projects/composition.js';

export async function createManifest(
  files: CollectedFile[],
  config: PackageConfig,
  kind: PackageManifest['kind'] = 'snapshot',
  baseRootHash?: string,
  baseFiles?: ManifestFile[],
  workspaceScope?: WorkspaceScope,
  composition?: ProjectComposition,
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
      mode: (file.preserveMode ?? config.preserveMode) ? file.mode : 0o644,
      ...((file.preserveMtime ?? config.preserveMtime)
        ? { mtime: file.mtime.toISOString() }
        : {}),
      sha256: sha256Buffer(content),
    });
  }
  manifestFiles.sort((left, right) => left.path.localeCompare(right.path));
  const rootHash = sha256Buffer(Buffer.from(stableJson(manifestFiles), 'utf8'));
  const manifest: PackageManifest = {
    schemaVersion: 1,
    kind,
    project: composition?.entry ?? path.basename(config.root),
    createdAt: new Date().toISOString(),
    rootHash,
    ...(baseRootHash ? { baseRootHash } : {}),
    ...(baseFiles ? { baseFiles } : {}),
    ...(manifestMonorepo(workspaceScope)
      ? { monorepo: manifestMonorepo(workspaceScope) }
      : {}),
    ...(manifestComposition(composition)
      ? { composition: manifestComposition(composition) }
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
