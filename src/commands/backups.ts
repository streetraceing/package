import path from 'node:path';
import { PackageError } from '../errors.js';
import {
  listBackupVersions,
  projectBackupDirectory,
  restoreBackupVersion,
  selectBackupVersion,
} from '../apply/backups.js';
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
} from '../util/terminal.js';

function requireSelector(value: string | undefined, action: string): string {
  if (value) return value;
  throw new PackageError(
    `package backup ${action} requires a version selector.`,
    'CLI_ARGUMENT',
  );
}

export async function backupCommand(
  action: string | undefined,
  selector: string | undefined,
  cwd: string,
  json: boolean,
  yes: boolean,
  saveDeletedCache = false,
): Promise<void> {
  const normalizedAction = action ?? 'list';
  if (normalizedAction === 'list') {
    const versions = await listBackupVersions(cwd);
    if (json) {
      console.log(
        JSON.stringify(
          {
            project: path.resolve(cwd),
            directory: projectBackupDirectory(cwd),
            versions: versions.map((version, index) => ({
              index: index + 1,
              id: version.id,
              kind: version.metadata.kind,
              createdAt: version.metadata.createdAt,
              paths: version.metadata.paths.length,
              sourceArchive: version.metadata.sourceArchive,
              restores: version.metadata.restores,
              legacy: version.legacy,
              archivePath: version.archivePath,
            })),
          },
          null,
          2,
        ),
      );
      return;
    }
    section('Backup history');
    console.log(
      `${color.muted(symbol.lastBranch)} ${label('Store')} ${color.light(projectBackupDirectory(cwd))}`,
    );
    if (versions.length === 0) {
      console.log(
        `${color.blue(symbol.info)} ${color.gray('No backup versions found for this project.')}`,
      );
      console.log(color.muted(divider(44)));
      return;
    }
    console.log('');
    for (const [index, version] of versions.entries()) {
      const marker =
        index === versions.length - 1 ? symbol.lastBranch : symbol.branch;
      const source = version.metadata.sourceArchive?.name
        ? ` ${color.muted('·')} ${color.blue(`source ${version.metadata.sourceArchive.name}`)}`
        : '';
      const legacy = version.legacy
        ? ` ${color.muted('·')} ${color.yellow('legacy')}`
        : '';
      console.log(
        `${color.muted(marker)} ${color.cyan(String(index + 1).padStart(2, '0'))} ${color.bold(version.id)}` +
          ` ${color.muted('·')} ${color.magenta(version.metadata.kind)}` +
          ` ${color.muted('·')} ${color.green(`${version.metadata.paths.length} paths`)}` +
          `${source}${legacy}`,
      );
    }
    console.log(color.muted(divider(44)));
    return;
  }

  const versions = await listBackupVersions(cwd);
  if (normalizedAction === 'inspect') {
    const selected = selectBackupVersion(
      versions,
      requireSelector(selector, normalizedAction),
    ).version;
    if (json) {
      console.log(
        JSON.stringify(
          {
            ...selected.metadata,
            archivePath: selected.archivePath,
            legacy: selected.legacy,
          },
          null,
          2,
        ),
      );
      return;
    }
    section('Backup details');
    console.log(
      `${color.muted(symbol.branch)} ${label('Version')} ${color.bold(selected.id)}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Kind')} ${color.magenta(selected.metadata.kind)}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Created')} ${color.gray(selected.metadata.createdAt)}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Project')} ${color.light(selected.metadata.projectRoot)}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Paths')} ${color.green(String(selected.metadata.paths.length))}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Archive')} ${color.light(selected.archivePath)}`,
    );
    if (selected.metadata.sourceArchive)
      console.log(
        `${color.muted(symbol.branch)} ${label('Source package')} ${color.blue(selected.metadata.sourceArchive.name)}`,
      );
    if (selected.metadata.restores?.length)
      console.log(
        `${color.muted(symbol.branch)} ${label('Restores')} ${color.magenta(selected.metadata.restores.join(', '))}`,
      );
    if (selected.legacy)
      console.log(
        `${color.muted(symbol.lastBranch)} ${color.yellow('Legacy project-local backup format')}`,
      );
    console.log(color.muted(divider(44)));
    return;
  }

  if (normalizedAction === 'restore') {
    const deletedCache = saveDeletedCache
      ? new DeletedCacheSession(cwd, 'backup-restore')
      : undefined;
    const result = await restoreBackupVersion(
      cwd,
      requireSelector(selector, normalizedAction),
      yes,
      deletedCache,
    );
    section('Backup restored');
    success(
      `Restored ${result.restoredVersions.length} backup version${result.restoredVersions.length === 1 ? '' : 's'} and ${result.changedPaths} paths.`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Target version')} ${color.cyan(result.selected.id)}`,
    );
    console.log(
      `${color.muted(symbol.lastBranch)} ${label('Recovery backup')} ${color.light(result.recoveryBackupPath)}`,
    );
    reportDeletedCache(deletedCache);
    console.log(color.muted(divider(44)));
    return;
  }

  throw new PackageError(
    `Unknown backup action: ${normalizedAction}. Use list, inspect, or restore.`,
    'CLI_ARGUMENT',
  );
}
