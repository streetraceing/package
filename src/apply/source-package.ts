import path from 'node:path';
import { lstat, readdir, rm } from 'node:fs/promises';
import type { LoadedPackage } from '../types.js';
import { loadPackage } from '../manifest/load.js';
import {
  readCurrentManifestFiles,
  rootHashForFiles,
} from '../manifest/state.js';
import { sha256File } from '../util/hash.js';
import type { DeletedCacheSession } from '../util/deleted-cache.js';

export interface SourcePackageCleanupContext {
  archivePath: string;
  projectRoot: string;
}

export interface SourcePackageCleanupPlan {
  candidatePath?: string;
  candidateHash?: string;
  matchedBy?: 'manifest-reference' | 'project-state';
  warning?: string;
}

function cleanupDirectories(context: SourcePackageCleanupContext): string[] {
  return [
    ...new Set(
      [path.dirname(context.archivePath), context.projectRoot].map((item) =>
        path.resolve(item),
      ),
    ),
  ];
}

async function regularFile(candidatePath: string): Promise<boolean> {
  try {
    const stat = await lstat(candidatePath);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function zipCandidates(
  context: SourcePackageCleanupContext,
): Promise<string[]> {
  const candidates: string[] = [];
  const seen = new Set<string>([path.resolve(context.archivePath)]);

  for (const directory of cleanupDirectories(context)) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.zip')
        continue;
      const candidatePath = path.resolve(directory, entry.name);
      if (seen.has(candidatePath)) continue;
      seen.add(candidatePath);
      candidates.push(candidatePath);
    }
  }

  return candidates.sort();
}

async function planFromManifestReference(
  pkg: LoadedPackage,
  context: SourcePackageCleanupContext,
): Promise<SourcePackageCleanupPlan | undefined> {
  const source = pkg.manifest.sourcePackage;
  if (!source) return undefined;

  const namedCandidates = cleanupDirectories(context).map((directory) =>
    path.resolve(directory, source.name),
  );
  const allCandidates = [
    ...new Set([...namedCandidates, ...(await zipCandidates(context))]),
  ];

  for (const candidatePath of allCandidates) {
    if (candidatePath === path.resolve(context.archivePath)) continue;
    if (!(await regularFile(candidatePath))) continue;
    try {
      if ((await sha256File(candidatePath)) !== source.sha256) continue;
      return {
        candidatePath,
        candidateHash: source.sha256,
        matchedBy: 'manifest-reference',
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

function packageBaseHash(pkg: LoadedPackage): string | undefined {
  if (pkg.manifest.baseRootHash) return pkg.manifest.baseRootHash;
  const base = pkg.shift?.instructions.find(
    (instruction) => instruction.type === 'BASE',
  );
  return base?.type === 'BASE' ? base.hash : undefined;
}

async function matchingSnapshotCandidates(
  pkg: LoadedPackage,
  context: SourcePackageCleanupContext,
): Promise<Array<{ path: string; hash: string }>> {
  const expectedBaseHash = packageBaseHash(pkg);
  const acceptedProjects = new Set([
    pkg.manifest.project,
    path.basename(context.projectRoot),
  ]);
  const matches: Array<{ path: string; hash: string }> = [];

  for (const candidatePath of await zipCandidates(context)) {
    try {
      if (!(await regularFile(candidatePath))) continue;
      const candidate = await loadPackage(candidatePath);
      if (candidate.manifest.kind !== 'snapshot') continue;
      if (!acceptedProjects.has(candidate.manifest.project)) continue;
      if (expectedBaseHash && candidate.manifest.rootHash !== expectedBaseHash)
        continue;

      const currentFiles = await readCurrentManifestFiles(
        context.projectRoot,
        candidate.manifest.files,
      );
      if (rootHashForFiles(currentFiles) !== candidate.manifest.rootHash)
        continue;

      matches.push({
        path: candidatePath,
        hash: await sha256File(candidatePath),
      });
    } catch {
      // A malformed or unrelated ZIP is not a cleanup candidate.
    }
  }

  return matches;
}

export async function prepareSourcePackageCleanup(
  pkg: LoadedPackage,
  context: SourcePackageCleanupContext,
): Promise<SourcePackageCleanupPlan> {
  if (pkg.manifest.sourcePackage) {
    const referenced = await planFromManifestReference(pkg, context);
    if (referenced) return referenced;
    return {
      warning: `source package ${pkg.manifest.sourcePackage.name} was not found with the exact SHA-256 recorded by the archive. No fallback archive was deleted.`,
    };
  }

  const matches = await matchingSnapshotCandidates(pkg, context);
  if (matches.length === 1) {
    const [match] = matches;
    if (!match) throw new Error('Expected one source package match.');
    return {
      candidatePath: match.path,
      candidateHash: match.hash,
      matchedBy: 'project-state',
    };
  }

  if (matches.length > 1) {
    return {
      warning: `source package cleanup was requested, but ${matches.length} snapshots match the project state before apply. No archive was deleted: ${matches.map((item) => path.basename(item.path)).join(', ')}`,
    };
  }

  return {
    warning:
      'source package cleanup was requested, but the archive has no exact source reference and no snapshot matching the project state before apply was found next to the applied archive or in the project root.',
  };
}

export async function deletePreparedSourcePackage(
  plan: SourcePackageCleanupPlan,
  deletedCache?: DeletedCacheSession,
): Promise<{ deletedPath?: string; warning?: string }> {
  if (!plan.candidatePath || !plan.candidateHash)
    return { warning: plan.warning };

  try {
    const stat = await lstat(plan.candidatePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return {
        warning: `source package was not deleted because it is no longer a regular file: ${plan.candidatePath}`,
      };
    }
    if ((await sha256File(plan.candidatePath)) !== plan.candidateHash) {
      return {
        warning: `source package was not deleted because it changed after cleanup was prepared: ${plan.candidatePath}`,
      };
    }
    if (deletedCache) {
      try {
        await deletedCache.cachePath(
          plan.candidatePath,
          'delete-source-package',
          path.basename(plan.candidatePath),
        );
      } catch (error) {
        return {
          warning: `source package was not deleted because it could not be saved to the deleted-file cache: ${(error as Error).message}`,
        };
      }
    }
    await rm(plan.candidatePath, { force: true });
    return { deletedPath: plan.candidatePath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        warning: `source package was not deleted because it no longer exists: ${plan.candidatePath}`,
      };
    }
    return {
      warning: `source package cleanup failed for ${plan.candidatePath}: ${(error as Error).message}`,
    };
  }
}
