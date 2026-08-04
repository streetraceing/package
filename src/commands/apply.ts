import path from 'node:path';
import { rm } from 'node:fs/promises';
import { loadPackage } from '../manifest/load.js';
import type { ApplyOptions, LoadedPackage } from '../types.js';
import { applyPackage } from '../apply/transaction.js';
import { comparePackageToProject } from './compare.js';
import { formatChanges } from './diff.js';
import { runPackageHooks } from '../util/hooks.js';
import {
  deletePreparedSourcePackage,
  prepareSourcePackageCleanup,
  type SourcePackageCleanupPlan,
} from '../apply/source-package.js';
import {
  DeletedCacheSession,
  reportDeletedCache,
} from '../util/deleted-cache.js';
import {
  color,
  divider,
  label,
  section,
  success,
  symbol,
  statusPrefix,
  warning,
} from '../util/terminal.js';
import { packagePayloadFiles } from '../archive/metadata.js';
import {
  confirmProjectMismatch,
  detectProjectMismatch,
} from '../apply/project-identity.js';

interface ApplyContext {
  archivePath: string;
  projectRoot: string;
}

function cleanupWarning(message: string, error?: unknown): void {
  const detail = error instanceof Error ? `: ${error.message}` : '';
  warning(`${message}${detail}`);
}

async function deleteSourcePackage(
  plan: SourcePackageCleanupPlan,
  deletedCache?: DeletedCacheSession,
): Promise<void> {
  const result = await deletePreparedSourcePackage(plan, deletedCache);
  if (result.deletedPath) {
    const suffix =
      plan.matchedBy === 'project-state'
        ? ' (matched project state before apply)'
        : '';
    success(`Deleted source package: ${result.deletedPath}${suffix}`);
  } else if (result.warning) {
    cleanupWarning(result.warning);
  }
}

async function deleteAppliedPackage(
  archivePath: string,
  deletedCache?: DeletedCacheSession,
): Promise<void> {
  try {
    if (deletedCache) {
      await deletedCache.cachePath(
        archivePath,
        'delete-applied-package',
        path.basename(archivePath),
      );
    }
    await rm(archivePath, { force: true });
    success(`Deleted package: ${archivePath}`);
  } catch (error) {
    cleanupWarning(
      deletedCache
        ? 'changes were applied, but the package could not be cached and deleted'
        : 'changes were applied, but the package could not be deleted',
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
      packageManager: options.packageManager,
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
  options: ApplyOptions,
  context: ApplyContext,
  sourceCleanupPlan: SourcePackageCleanupPlan | undefined,
  deletedCache?: DeletedCacheSession,
): Promise<void> {
  await runAfterApplyHooks(options, context);
  if (options.deleteSourcePackageOnApply && sourceCleanupPlan)
    await deleteSourcePackage(sourceCleanupPlan, deletedCache);
  if (options.deletePackageOnApply)
    await deleteAppliedPackage(context.archivePath, deletedCache);
}

function detailLine(
  branch: typeof symbol.branch | typeof symbol.lastBranch,
  name: string,
  value: string,
): void {
  console.log(`${color.muted(branch)} ${label(name)} ${color.light(value)}`);
}

function printPackageMetadata(pkg: LoadedPackage, context: ApplyContext): void {
  section('Apply plan');
  detailLine(symbol.branch, 'Package', context.archivePath);
  detailLine(symbol.lastBranch, 'Target', context.projectRoot);
  if (pkg.manifestSource === 'generated') {
    warning(
      'archive has no embedded manifest; applying ZIP-verified payload and .packageshift instructions without base verification.',
    );
  } else if (pkg.manifestSource === 'legacy') {
    console.log(
      `${statusPrefix('info')} ${label('Manifest')} ${color.blue('legacy .packagemanifest')}`,
    );
  }
  if (pkg.ignoredPayloadMetadataPaths.length > 0) {
    warning(
      `reserved CLI metadata listed as payload was ignored: ${pkg.ignoredPayloadMetadataPaths.join(', ')}`,
    );
  }
}

function printApplyPolicies(options: ApplyOptions): void {
  const policies: string[] = [];
  if (options.force) policies.push(`${color.red('conflicts: force')}`);
  else if (options.conflictStrategy !== 'abort')
    policies.push(`${color.yellow(`conflicts: ${options.conflictStrategy}`)}`);
  if (options.rewriteAll) policies.push(color.magenta('write: rewrite all'));
  if (options.dryRun) policies.push(color.blue('mode: dry run'));
  if (policies.length > 0)
    console.log(
      `${statusPrefix('info')} ${label('Policies')} ${policies.join(color.muted(`  ${symbol.separator}  `))}`,
    );
}

function printRewriteExpansion(
  pkg: LoadedPackage,
  options: ApplyOptions,
  changedPaths: Set<string>,
): void {
  if (!options.rewriteAll) return;
  const unchangedPayloadFiles = packagePayloadFiles(pkg.manifest.files).filter(
    (file) => !changedPaths.has(file.path),
  ).length;
  if (unchangedPayloadFiles > 0)
    console.log(
      `${statusPrefix('info')} ${label('Rewrite expansion')} ${color.magenta(String(unchangedPayloadFiles))} unchanged ` +
        `payload file${unchangedPayloadFiles === 1 ? '' : 's'} will also be written`,
    );
}

function applySummary(
  changedPaths: number,
  writtenFiles: number,
  modeOnlyFiles: number,
  planned = false,
): string {
  const details: string[] = [];
  if (writtenFiles > 0)
    details.push(
      `${writtenFiles} file${writtenFiles === 1 ? '' : 's'} ${planned ? 'would be written' : 'written'}`,
    );
  if (modeOnlyFiles > 0)
    details.push(
      `${modeOnlyFiles} mode-only change${modeOnlyFiles === 1 ? '' : 's'}`,
    );
  const suffix = details.length > 0 ? ` (${details.join(', ')})` : '';
  return `${changedPaths} path${changedPaths === 1 ? '' : 's'}${suffix}`;
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
  const projectMismatch = await detectProjectMismatch(
    pkg,
    context.projectRoot,
    comparison.baseMatches,
  );
  const sourceCleanupPlan =
    !options.dryRun && options.deleteSourcePackageOnApply
      ? await prepareSourcePackageCleanup(pkg, context)
      : undefined;
  const deletedCache =
    !options.dryRun && options.saveDeletedCache === true
      ? new DeletedCacheSession(
          context.projectRoot,
          'apply',
          context.archivePath,
        )
      : undefined;

  printPackageMetadata(pkg, context);
  printApplyPolicies(options);
  printRewriteExpansion(
    pkg,
    options,
    new Set(
      comparison.changes
        .filter((change) => change.kind !== 'UNCHANGED')
        .map((change) => change.path),
    ),
  );
  console.log(color.muted(divider(44)));
  console.log('');
  section('Changes');
  console.log(formatChanges(comparison.changes));
  console.log('');
  await confirmProjectMismatch(projectMismatch, options);
  if (projectMismatch && !options.dryRun) console.log('');

  const result = await applyPackage(
    pkg,
    {
      ...options,
      cwd: context.projectRoot,
    },
    deletedCache,
  );

  section(options.dryRun ? 'Dry-run result' : 'Apply result');
  if (options.dryRun) {
    console.log(
      `${statusPrefix('info')} ${color.blue('No files were written.')} ${color.light(
        `${applySummary(
          result.changedPaths,
          result.writtenFiles,
          result.modeOnlyFiles,
          true,
        )} would be changed.`,
      )}`,
    );
  } else {
    if (result.changedPaths === 0) success('Project is already up to date.');
    else
      success(
        `Applied ${applySummary(
          result.changedPaths,
          result.writtenFiles,
          result.modeOnlyFiles,
        )}.`,
      );
    if (result.backupPath)
      console.log(
        `${color.muted(symbol.branch)} ${color.green(symbol.success)} ${label('Backup')} ${color.light(result.backupPath)}`,
      );
  }
  if (result.overwrittenConflicts.length > 0)
    console.log(
      `${color.muted(symbol.branch)} ${color.orange(symbol.conflict)} ${label('Overwritten conflicts')} ${color.orange(result.overwrittenConflicts.join(', '))}`,
    );
  if (result.skippedPaths.length > 0)
    console.log(
      `${color.muted(symbol.branch)} ${color.yellow(symbol.warning)} ${label('Skipped conflicts')} ${color.yellow(result.skippedPaths.join(', '))}`,
    );

  if (!options.dryRun) {
    await runPostApplyLifecycle(
      options,
      context,
      sourceCleanupPlan,
      deletedCache,
    );
    reportDeletedCache(deletedCache);
  }
  console.log(color.muted(divider(44)));
}
