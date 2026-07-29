import path from 'node:path';
import { lstat, rm } from 'node:fs/promises';
import { loadPackage } from '../manifest/load.js';
import type { ApplyOptions, LoadedPackage } from '../types.js';
import { applyPackage } from '../apply/transaction.js';
import { comparePackageToProject } from './compare.js';
import { formatChanges } from './diff.js';
import { runPackageHooks } from '../util/hooks.js';
import { sha256File } from '../util/hash.js';

interface ApplyContext {
  archivePath: string;
  projectRoot: string;
}

function cleanupWarning(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `: ${error.message}` : '';
  console.warn(`Warning: ${message}${detail}`);
}

async function deleteSourcePackage(
  pkg: LoadedPackage,
  context: ApplyContext,
): Promise<void> {
  const source = pkg.manifest.sourcePackage;
  if (!source) {
    cleanupWarning(
      'source package cleanup was requested, but this archive does not identify the snapshot used to create it.',
    );
    return;
  }

  const candidates = [
    path.join(path.dirname(context.archivePath), source.name),
    path.join(context.projectRoot, source.name),
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (resolved === context.archivePath || seen.has(resolved)) continue;
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
      cleanupWarning(`source package cleanup failed for ${resolved}`, error);
      return;
    }
  }

  cleanupWarning(
    `source package ${source.name} was not deleted because no exact SHA-256 match was found next to the applied archive or in the project root.`,
  );
}

async function deleteAppliedPackage(archivePath: string): Promise<void> {
  try {
    await rm(archivePath, { force: true });
    console.log(`Deleted package: ${archivePath}`);
  } catch (error) {
    cleanupWarning(
      'changes were applied, but the package could not be deleted',
      error,
    );
  }
}

async function runAfterApplyHooks(
  options: ApplyOptions,
  context: ApplyContext,
): Promise<void> {
  const failures = await runPackageHooks(
    'afterApply',
    options.afterApply ?? [],
    {
      root: context.projectRoot,
      archivePath: context.archivePath,
      command: 'apply',
    },
    { failureMode: 'warn' },
  );

  if (failures.length > 0) {
    cleanupWarning(
      `${failures.length} afterApply script${failures.length === 1 ? '' : 's'} failed. Project changes remain applied and cleanup continues.`,
    );
  }
}

async function runPostApplyLifecycle(
  pkg: LoadedPackage,
  options: ApplyOptions,
  context: ApplyContext,
): Promise<void> {
  await runAfterApplyHooks(options, context);
  if (options.deleteSourcePackageOnApply)
    await deleteSourcePackage(pkg, context);
  if (options.deletePackageOnApply)
    await deleteAppliedPackage(context.archivePath);
}

function printPackageMetadata(pkg: LoadedPackage, context: ApplyContext): void {
  console.log(`Package: ${context.archivePath}`);
  console.log(`Target:  ${context.projectRoot}`);
  if (pkg.manifestSource === 'generated') {
    console.log(
      'Warning: archive has no embedded manifest; applying ZIP-verified payload and .packageshift instructions without base verification.',
    );
  } else if (pkg.manifestSource === 'legacy') {
    console.log('Manifest: legacy .packagemanifest');
  }
}

function printConflictPolicy(options: ApplyOptions): void {
  if (options.force) console.log('Conflict policy: force');
  else if (options.conflictStrategy !== 'abort')
    console.log(`Conflict policy: ${options.conflictStrategy}`);
}

export async function applyCommand(
  archivePath: string,
  options: ApplyOptions,
): Promise<void> {
  const context: ApplyContext = {
    archivePath: path.resolve(options.cwd, archivePath),
    projectRoot: path.resolve(options.cwd),
  };
  const pkg = await loadPackage(context.archivePath);
  const comparison = await comparePackageToProject(pkg, context.projectRoot);

  printPackageMetadata(pkg, context);
  printConflictPolicy(options);
  console.log('');
  console.log(formatChanges(comparison.changes));
  console.log('');

  const result = await applyPackage(pkg, {
    ...options,
    cwd: context.projectRoot,
  });
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

  if (!options.dryRun) await runPostApplyLifecycle(pkg, options, context);
}
