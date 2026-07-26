import path from 'node:path';
import { loadPackage } from '../manifest/load.js';
import type { ApplyOptions } from '../types.js';
import { applyPackage } from '../apply/transaction.js';
import { comparePackageToProject } from './compare.js';
import { formatChanges } from './diff.js';

export async function applyCommand(
  archivePath: string,
  options: ApplyOptions,
): Promise<void> {
  const resolvedArchive = path.resolve(options.cwd, archivePath);
  const pkg = await loadPackage(resolvedArchive);
  const comparison = await comparePackageToProject(pkg, options.cwd);
  console.log(`Package: ${resolvedArchive}`);
  console.log(`Target:  ${path.resolve(options.cwd)}`);
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
}
