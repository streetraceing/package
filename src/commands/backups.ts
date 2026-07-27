import path from 'node:path';
import { PackageError } from '../errors.js';
import {
  listBackupVersions,
  projectBackupDirectory,
  restoreBackupVersion,
  selectBackupVersion,
} from '../apply/backups.js';

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
    console.log(`Backup store: ${projectBackupDirectory(cwd)}`);
    if (versions.length === 0) {
      console.log('No backup versions found for this project.');
      return;
    }
    for (const [index, version] of versions.entries()) {
      const source = version.metadata.sourceArchive?.name
        ? `, source ${version.metadata.sourceArchive.name}`
        : '';
      const legacy = version.legacy ? ', legacy' : '';
      console.log(
        `${index + 1}. ${version.id}  ${version.metadata.kind}, ${version.metadata.paths.length} paths${source}${legacy}`,
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
    console.log(`Version: ${selected.id}`);
    console.log(`Kind: ${selected.metadata.kind}`);
    console.log(`Created: ${selected.metadata.createdAt}`);
    console.log(`Project: ${selected.metadata.projectRoot}`);
    console.log(`Paths: ${selected.metadata.paths.length}`);
    console.log(`Archive: ${selected.archivePath}`);
    if (selected.metadata.sourceArchive)
      console.log(`Source package: ${selected.metadata.sourceArchive.name}`);
    if (selected.metadata.restores?.length)
      console.log(`Restores: ${selected.metadata.restores.join(', ')}`);
    if (selected.legacy) console.log('Format: legacy project-local backup');
    return;
  }

  if (normalizedAction === 'restore') {
    const result = await restoreBackupVersion(
      cwd,
      requireSelector(selector, normalizedAction),
      yes,
    );
    console.log(
      `Restored ${result.restoredVersions.length} backup version${result.restoredVersions.length === 1 ? '' : 's'} and ${result.changedPaths} paths.`,
    );
    console.log(`Target version: ${result.selected.id}`);
    console.log(`Recovery backup: ${result.recoveryBackupPath}`);
    return;
  }

  throw new PackageError(
    `Unknown backup action: ${normalizedAction}. Use list, inspect, or restore.`,
    'CLI_ARGUMENT',
  );
}
