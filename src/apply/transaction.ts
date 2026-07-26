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

async function verifyExpected(
  root: string,
  instruction: ShiftInstruction,
  force: boolean,
): Promise<void> {
  if (
    instruction.type !== 'REMOVE' &&
    instruction.type !== 'MOVE' &&
    instruction.type !== 'REPLACE'
  )
    return;
  const expectedHash = instruction.expectedHash;
  if (!expectedHash) return;
  const relativePath =
    instruction.type === 'MOVE' ? instruction.from : instruction.path;
  const current = await existingFile(root, relativePath);
  if (!current) {
    if (instruction.type === 'MOVE') {
      const destination = await existingFile(root, instruction.to);
      if (destination && sha256Buffer(destination.data) === expectedHash)
        return;
    }
    if (!force)
      throw new PackageError(
        `Expected file is missing: ${relativePath}`,
        'APPLY_CONFLICT',
      );
    return;
  }
  const currentHash = sha256Buffer(current.data);
  if (currentHash !== expectedHash && !force) {
    throw new PackageError(
      `File has changed since the base package: ${relativePath}\nExpected ${expectedHash}\nCurrent  ${currentHash}`,
      'APPLY_CONFLICT',
    );
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
): Promise<{ backupPath?: string; changedPaths: number }> {
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
  for (const instruction of pkg.shift?.instructions ?? [])
    await verifyExpected(options.cwd, instruction, options.force);
  if (options.dryRun) return { changedPaths: paths.length };
  if (!(await shouldProceed(options, paths.length)))
    throw new PackageError('Apply cancelled.', 'APPLY_CANCELLED');

  const backup = await captureBackup(options.cwd, paths);
  const backupPath = options.backup
    ? await persistBackup(options.cwd, backup)
    : undefined;
  try {
    for (const instruction of pkg.shift?.instructions ?? [])
      await executeInstruction(options.cwd, instruction, options);
    for (const file of pkg.manifest.files) {
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
  return { backupPath, changedPaths: paths.length };
}
