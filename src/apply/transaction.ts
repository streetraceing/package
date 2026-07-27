import path from 'node:path';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type {
  ApplyOptions,
  ArchiveEntry,
  ConflictStrategy,
  LoadedPackage,
  ShiftInstruction,
} from '../types.js';
import { PackageError } from '../errors.js';
import { assertNoSymlinkAncestors, resolveInside } from '../util/path.js';
import { sha256Buffer } from '../util/hash.js';
import {
  readCurrentManifestFiles,
  rootHashForFiles,
} from '../manifest/state.js';
import { writeZip } from '../archive/zip.js';
import { runPackageHooks } from '../util/hooks.js';

interface BackupItem {
  path: string;
  existed: boolean;
  data?: Buffer;
  mode?: number;
}

async function existingFile(
  root: string,
  relativePath: string,
): Promise<{ data: Buffer; mode: number } | undefined> {
  const absolutePath = resolveInside(root, relativePath);
  try {
    const stat = await lstat(absolutePath);
    if (stat.isSymbolicLink())
      throw new PackageError(
        `Refusing to modify symbolic link: ${relativePath}`,
        'SYMLINK_PATH',
      );
    if (!stat.isFile())
      throw new PackageError(
        `Expected a regular file: ${relativePath}`,
        'NOT_A_FILE',
      );
    return { data: await readFile(absolutePath), mode: stat.mode & 0o777 };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function affectedPaths(pkg: LoadedPackage): string[] {
  const paths = new Set(pkg.manifest.files.map((file) => file.path));
  for (const instruction of pkg.shift?.instructions ?? []) {
    if (
      instruction.type === 'REMOVE' ||
      instruction.type === 'REPLACE' ||
      instruction.type === 'CHMOD'
    )
      paths.add(instruction.path);
    else if (instruction.type === 'MOVE' || instruction.type === 'COPY') {
      paths.add(instruction.from);
      paths.add(instruction.to);
    }
  }
  return [...paths].sort();
}

async function ensureSafePaths(root: string, paths: string[]): Promise<void> {
  for (const relativePath of paths) {
    resolveInside(root, relativePath);
    await assertNoSymlinkAncestors(root, relativePath);
    const absolutePath = resolveInside(root, relativePath);
    try {
      const stat = await lstat(absolutePath);
      if (stat.isSymbolicLink())
        throw new PackageError(
          `Refusing to modify symbolic link: ${relativePath}`,
          'SYMLINK_PATH',
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

interface ExpectedConflict {
  instruction: ShiftInstruction;
  path: string;
  expectedHash: string;
  currentHash?: string;
  reason: 'missing' | 'changed';
}

async function expectedConflict(
  root: string,
  instruction: ShiftInstruction,
): Promise<ExpectedConflict | undefined> {
  if (
    instruction.type !== 'REMOVE' &&
    instruction.type !== 'MOVE' &&
    instruction.type !== 'REPLACE'
  )
    return undefined;
  const expectedHash = instruction.expectedHash;
  if (!expectedHash) return undefined;
  const relativePath =
    instruction.type === 'MOVE' ? instruction.from : instruction.path;
  const current = await existingFile(root, relativePath);
  if (!current) {
    if (instruction.type === 'MOVE') {
      const destination = await existingFile(root, instruction.to);
      if (destination && sha256Buffer(destination.data) === expectedHash)
        return undefined;
    }
    return {
      instruction,
      path: relativePath,
      expectedHash,
      reason: 'missing',
    };
  }
  const currentHash = sha256Buffer(current.data);
  if (currentHash === expectedHash) return undefined;
  return {
    instruction,
    path: relativePath,
    expectedHash,
    currentHash,
    reason: 'changed',
  };
}

function conflictPaths(conflict: ExpectedConflict): string[] {
  const instruction = conflict.instruction;
  if (instruction.type === 'MOVE') return [instruction.from, instruction.to];
  if (instruction.type === 'REMOVE' || instruction.type === 'REPLACE')
    return [instruction.path];
  return [];
}

function conflictMessage(conflict: ExpectedConflict): string {
  const details =
    conflict.reason === 'missing'
      ? `Expected file is missing: ${conflict.path}`
      : `File has changed since the base package: ${conflict.path}\nExpected ${conflict.expectedHash}\nCurrent  ${conflict.currentHash}`;
  return `${details}\nNo files were changed. Re-run with --conflict overwrite to replace conflicting files, --conflict skip to leave them unchanged, or --force to bypass all guards.`;
}

async function chooseConflictStrategy(
  options: ApplyOptions,
  conflictCount: number,
): Promise<ConflictStrategy> {
  if (options.force) return 'overwrite';
  if (options.conflictStrategy !== 'abort') return options.conflictStrategy;
  if (options.yes || !process.stdin.isTTY || !process.stdout.isTTY)
    return 'abort';

  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(
      `${conflictCount} .packageshift hash conflict${conflictCount === 1 ? '' : 's'} detected. [a]bort, [o]verwrite, or [s]kip? [a] `,
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized === 'o' || normalized === 'overwrite') return 'overwrite';
    if (normalized === 's' || normalized === 'skip') return 'skip';
    return 'abort';
  } finally {
    readline.close();
  }
}

async function captureBackup(
  root: string,
  paths: string[],
): Promise<BackupItem[]> {
  const backup: BackupItem[] = [];
  for (const relativePath of paths) {
    const current = await existingFile(root, relativePath);
    backup.push(
      current
        ? {
            path: relativePath,
            existed: true,
            data: current.data,
            mode: current.mode,
          }
        : { path: relativePath, existed: false },
    );
  }
  return backup;
}

async function persistBackup(
  root: string,
  backup: BackupItem[],
): Promise<string> {
  const date = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(root, '.package-backups', `${date}.zip`);
  await mkdir(path.dirname(backupPath), { recursive: true });
  const metadata = backup.map(({ path: itemPath, existed, mode }) => ({
    path: itemPath,
    existed,
    mode,
  }));
  const entries: ArchiveEntry[] = backup
    .filter(
      (item): item is BackupItem & { data: Buffer } =>
        item.existed && item.data !== undefined,
    )
    .map((item) => ({
      path: item.path,
      data: item.data,
      mode: item.mode ?? 0o644,
    }));
  entries.push({
    path: '.packagebackup.json',
    data: Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`, 'utf8'),
    mode: 0o600,
  });
  await writeZip(backupPath, entries, {
    compressionLevel: 9,
    deterministic: false,
  });
  return backupPath;
}

async function restoreBackup(
  root: string,
  backup: BackupItem[],
): Promise<void> {
  for (const item of [...backup].reverse()) {
    const absolutePath = resolveInside(root, item.path);
    if (!item.existed) {
      await rm(absolutePath, { force: true, recursive: true });
      continue;
    }
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, item.data as Buffer);
    await chmod(absolutePath, item.mode ?? 0o644);
  }
}

async function shouldProceed(
  options: ApplyOptions,
  count: number,
): Promise<boolean> {
  if (options.yes) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new PackageError(
      'Refusing to apply changes without confirmation in a non-interactive shell. Pass --yes.',
      'CONFIRMATION_REQUIRED',
    );
  }
  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(
      `${count} paths may be changed. Continue? [y/N] `,
    );
    return (
      answer.trim().toLowerCase() === 'y' ||
      answer.trim().toLowerCase() === 'yes'
    );
  } finally {
    readline.close();
  }
}

async function makeParent(root: string, relativePath: string): Promise<string> {
  const absolutePath = resolveInside(root, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  return absolutePath;
}

async function executeInstruction(
  root: string,
  instruction: ShiftInstruction,
  options: ApplyOptions,
): Promise<void> {
  if (
    instruction.type === 'MESSAGE' ||
    instruction.type === 'BASE' ||
    instruction.type === 'REPLACE'
  )
    return;
  if (instruction.type === 'REMOVE') {
    await rm(resolveInside(root, instruction.path), {
      force: true,
      recursive: true,
    });
    return;
  }
  if (instruction.type === 'MOVE') {
    const source = resolveInside(root, instruction.from);
    const destination = await makeParent(root, instruction.to);
    try {
      await lstat(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          await lstat(destination);
          return;
        } catch (destinationError) {
          if (
            (destinationError as NodeJS.ErrnoException).code === 'ENOENT' &&
            !options.force
          ) {
            throw new PackageError(
              `MOVE source does not exist: ${instruction.from}`,
              'APPLY_CONFLICT',
            );
          }
          if ((destinationError as NodeJS.ErrnoException).code !== 'ENOENT')
            throw destinationError;
          return;
        }
      }
      throw error;
    }
    try {
      await lstat(destination);
      if (options.conflictStrategy === 'skip') return;
      if (options.conflictStrategy === 'abort' && !options.force)
        throw new PackageError(
          `MOVE destination already exists: ${instruction.to}`,
          'APPLY_CONFLICT',
        );
      await rm(destination, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(source, destination);
    return;
  }
  if (instruction.type === 'COPY') {
    const source = resolveInside(root, instruction.from);
    const destination = await makeParent(root, instruction.to);
    try {
      await lstat(destination);
      if (options.conflictStrategy === 'skip') return;
      if (options.conflictStrategy === 'abort' && !options.force)
        throw new PackageError(
          `COPY destination already exists: ${instruction.to}`,
          'APPLY_CONFLICT',
        );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await copyFile(source, destination);
    return;
  }
  if (instruction.type === 'CHMOD') {
    await chmod(resolveInside(root, instruction.path), instruction.mode);
  }
}

export async function applyPackage(
  pkg: LoadedPackage,
  options: ApplyOptions,
): Promise<{
  backupPath?: string;
  changedPaths: number;
  skippedPaths: string[];
  overwrittenConflicts: string[];
}> {
  const paths = affectedPaths(pkg);
  await ensureSafePaths(options.cwd, paths);
  if (pkg.manifest.baseFiles && pkg.manifest.baseRootHash && !options.force) {
    const currentFiles = await readCurrentManifestFiles(
      options.cwd,
      pkg.manifest.baseFiles,
    );
    const currentHash = rootHashForFiles(currentFiles);
    if (currentHash !== pkg.manifest.baseRootHash) {
      throw new PackageError(
        `Project does not match the patch base.\nExpected ${pkg.manifest.baseRootHash}\nCurrent  ${currentHash}\nReview with diff or pass --force.`,
        'BASE_MISMATCH',
      );
    }
  }
  const conflicts: ExpectedConflict[] = [];
  for (const instruction of pkg.shift?.instructions ?? []) {
    const conflict = await expectedConflict(options.cwd, instruction);
    if (conflict) conflicts.push(conflict);
  }
  const conflictStrategy =
    conflicts.length === 0
      ? options.conflictStrategy
      : await chooseConflictStrategy(options, conflicts.length);
  const skippedInstructions = new Set<ShiftInstruction>();
  const skippedPaths = new Set<string>();
  const overwrittenConflicts: string[] = [];
  for (const conflict of conflicts) {
    if (conflictStrategy === 'overwrite') {
      overwrittenConflicts.push(conflict.path);
      continue;
    }
    if (conflictStrategy === 'skip') {
      skippedInstructions.add(conflict.instruction);
      for (const conflictPath of conflictPaths(conflict))
        skippedPaths.add(conflictPath);
      continue;
    }
    throw new PackageError(conflictMessage(conflict), 'APPLY_CONFLICT');
  }
  const activePaths = paths.filter((item) => !skippedPaths.has(item));
  if (options.dryRun)
    return {
      changedPaths: activePaths.length,
      skippedPaths: [...skippedPaths].sort(),
      overwrittenConflicts: overwrittenConflicts.sort(),
    };
  if (!(await shouldProceed(options, activePaths.length)))
    throw new PackageError('Apply cancelled.', 'APPLY_CANCELLED');

  await runPackageHooks('beforeApply', options.beforeApply ?? [], {
    root: options.cwd,
    archivePath: pkg.archivePath,
    command: 'apply',
  });

  const backup = await captureBackup(options.cwd, activePaths);
  const backupPath = options.backup
    ? await persistBackup(options.cwd, backup)
    : undefined;
  try {
    for (const instruction of pkg.shift?.instructions ?? []) {
      if (skippedInstructions.has(instruction)) continue;
      await executeInstruction(options.cwd, instruction, options);
    }
    for (const file of pkg.manifest.files) {
      if (skippedPaths.has(file.path)) continue;
      const entry = pkg.entries.get(file.path);
      if (!entry)
        throw new PackageError(
          `Archive payload is missing: ${file.path}`,
          'ARCHIVE_INCOMPLETE',
        );
      const destination = await makeParent(options.cwd, file.path);
      await writeFile(destination, entry.data);
      await chmod(destination, file.mode & 0o777);
    }
  } catch (error) {
    await restoreBackup(options.cwd, backup);
    throw new PackageError(
      `Apply failed and changes were rolled back: ${(error as Error).message}`,
      'APPLY_ROLLBACK',
    );
  }
  return {
    backupPath,
    changedPaths: activePaths.length,
    skippedPaths: [...skippedPaths].sort(),
    overwrittenConflicts: overwrittenConflicts.sort(),
  };
}
