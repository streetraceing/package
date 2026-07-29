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
import { color, label, success } from '../util/terminal.js';

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
    console.log(`${label('Backup store')} ${projectBackupDirectory(cwd)}`);
    if (versions.length === 0) {
      console.log(color.dim('No backup versions found for this project.'));
      return;
    }
    for (const [index, version] of versions.entries()) {
      const source = version.metadata.sourceArchive?.name
        ? `, source ${version.metadata.sourceArchive.name}`
        : '';
      const legacy = version.legacy ? ', legacy' : '';
      console.log(
        `${color.cyan(String(index + 1))}. ${version.id}  ${version.metadata.kind}, ${version.metadata.paths.length} paths${source}${legacy}`,
      );
    }
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
    console.log(`${label('Version')} ${color.bold(selected.id)}`);
    console.log(`${label('Kind')} ${selected.metadata.kind}`);
    console.log(`${label('Created')} ${selected.metadata.createdAt}`);
    console.log(`${label('Project')} ${selected.metadata.projectRoot}`);
    console.log(`${label('Paths')} ${selected.metadata.paths.length}`);
    console.log(`${label('Archive')} ${selected.archivePath}`);
    if (selected.metadata.sourceArchive)
      console.log(
        `${label('Source package')} ${selected.metadata.sourceArchive.name}`,
      );
    if (selected.metadata.restores?.length)
      console.log(
        `${label('Restores')} ${selected.metadata.restores.join(', ')}`,
      );
    if (selected.legacy)
      console.log(color.dim('Format: legacy project-local backup'));
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
    success(
      `Restored ${result.restoredVersions.length} backup version${result.restoredVersions.length === 1 ? '' : 's'} and ${result.changedPaths} paths.`,
    );
    console.log(`${label('Target version')} ${result.selected.id}`);
    console.log(`${label('Recovery backup')} ${result.recoveryBackupPath}`);
    reportDeletedCache(deletedCache);
    return;
  }

  throw new PackageError(
    `Unknown backup action: ${normalizedAction}. Use list, inspect, or restore.`,
    'CLI_ARGUMENT',
  );
}
