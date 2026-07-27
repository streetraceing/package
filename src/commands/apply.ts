import path from 'node:path';
import { lstat, rm } from 'node:fs/promises';
import { loadPackage } from '../manifest/load.js';
import type { ApplyOptions, LoadedPackage } from '../types.js';
import { applyPackage } from '../apply/transaction.js';
import { comparePackageToProject } from './compare.js';
import { formatChanges } from './diff.js';
import { runPackageHooks } from '../util/hooks.js';
import { sha256File } from '../util/hash.js';

async function deleteSourcePackage(
  pkg: LoadedPackage,
  appliedArchivePath: string,
  projectRoot: string,
): Promise<void> {
  const source = pkg.manifest.sourcePackage;
  if (!source) {
    console.warn(
      'Warning: source package cleanup was requested, but this archive does not identify the snapshot used to create it.',
    );
    return;
  }
  const candidates = [
    path.join(path.dirname(appliedArchivePath), source.name),
    path.join(projectRoot, source.name),
  ];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (resolved === appliedArchivePath || seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      const fileStat = await lstat(resolved);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
      if ((await sha256File(resolved)) !== source.sha256) continue;
      await rm(resolved, { force: true });
      console.log(`Deleted source package: ${resolved}`);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      console.warn(
        `Warning: source package cleanup failed for ${resolved}: ${(error as Error).message}`,
      );
      return;
    }
  }
  console.warn(
    `Warning: source package ${source.name} was not deleted because no exact SHA-256 match was found next to the applied archive or in the project root.`,
  );
}

export async function applyCommand(
  archivePath: string,
  options: ApplyOptions,
): Promise<void> {
  const resolvedArchive = path.resolve(options.cwd, archivePath);
  const pkg = await loadPackage(resolvedArchive);
  const comparison = await comparePackageToProject(pkg, options.cwd);
  console.log(`Package: ${resolvedArchive}`);
  console.log(`Target:  ${path.resolve(options.cwd)}`);
  if (pkg.manifestSource === 'generated') {
    console.log(
      'Warning: archive has no embedded manifest; applying ZIP-verified payload and .packageshift instructions without base verification.',
    );
  } else if (pkg.manifestSource === 'legacy') {
    console.log('Manifest: legacy .packagemanifest');
  }
  if (options.force) console.log('Conflict policy: force');
  else if (options.conflictStrategy !== 'abort')
    console.log(`Conflict policy: ${options.conflictStrategy}`);
  console.log('');
  console.log(formatChanges(comparison.changes));
  console.log('');
  const result = await applyPackage(pkg, options);
  if (options.dryRun) {
    console.log(
      `Dry run complete. ${result.changedPaths} paths may be changed.`,
    );
  } else {
    console.log(`Applied ${result.changedPaths} paths.`);
    if (result.backupPath) console.log(`Backup: ${result.backupPath}`);
  }
  if (result.overwrittenConflicts.length > 0)
    console.log(
      `Overwritten conflicts: ${result.overwrittenConflicts.join(', ')}`,
    );
  if (result.skippedPaths.length > 0)
    console.log(`Skipped conflicts: ${result.skippedPaths.join(', ')}`);
  if (!options.dryRun) {
    await runPackageHooks('afterApply', options.afterApply ?? [], {
      root: path.resolve(options.cwd),
      archivePath: resolvedArchive,
      command: 'apply',
    });
  }
  if (!options.dryRun && options.deleteSourcePackageOnApply)
    await deleteSourcePackage(pkg, resolvedArchive, path.resolve(options.cwd));
  if (!options.dryRun && options.deletePackageOnApply) {
    try {
      await rm(resolvedArchive, { force: true });
      console.log(`Deleted package: ${resolvedArchive}`);
    } catch (error) {
      console.warn(
        `Warning: changes were applied, but the package could not be deleted: ${(error as Error).message}`,
      );
    }
  }
}
