import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type {
  ArchiveEntry,
  CollectedFile,
  PackageConfig,
  ShiftInstruction,
} from '../types.js';
import { loadPackage } from '../manifest/load.js';
import { collectFiles } from '../files/collect.js';
import { createManifest } from '../manifest/create.js';
import { writeZip } from '../archive/zip.js';
import { renderShift } from '../shift/render.js';
import { sha256File } from '../util/hash.js';
import { PackageError } from '../errors.js';

export interface ShiftCommandOptions {
  output?: string;
  message?: string;
  quiet?: boolean;
}

export async function createShiftArchive(
  baseArchive: string,
  config: PackageConfig,
  options: ShiftCommandOptions = {},
): Promise<string> {
  const base = await loadPackage(path.resolve(config.root, baseArchive));
  if (base.manifest.kind !== 'snapshot')
    throw new PackageError(
      'The base archive must be a snapshot created by package zip.',
      'BASE_NOT_SNAPSHOT',
    );
  const outputPath = options.output
    ? path.resolve(config.root, options.output)
    : path.resolve(config.output, `${path.basename(config.root)}-shift.zip`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const resolvedBaseArchive = path.resolve(config.root, baseArchive);
  const baseRelative = path
    .relative(config.root, resolvedBaseArchive)
    .replaceAll('\\', '/');
  const collectionConfig =
    !baseRelative.startsWith('../') && !path.isAbsolute(baseRelative)
      ? { ...config, ignore: [...config.ignore, baseRelative] }
      : config;
  const currentFiles = await collectFiles(collectionConfig, outputPath);
  const currentByPath = new Map(
    currentFiles.map((file) => [file.relativePath, file]),
  );
  const baseByPath = new Map(
    base.manifest.files.map((file) => [file.path, file]),
  );
  const currentHashes = new Map<string, string>();
  for (const file of currentFiles)
    currentHashes.set(file.relativePath, await sha256File(file.absolutePath));

  const removed = base.manifest.files.filter(
    (file) => !currentByPath.has(file.path),
  );
  const added = currentFiles.filter(
    (file) => !baseByPath.has(file.relativePath),
  );
  const modified: CollectedFile[] = [];
  const modeChanges: Array<{ path: string; mode: number }> = [];
  for (const file of currentFiles) {
    const previous = baseByPath.get(file.relativePath);
    if (!previous) continue;
    const currentHash = currentHashes.get(file.relativePath);
    if (currentHash !== previous.sha256) modified.push(file);
    else if ((file.mode & 0o777) !== (previous.mode & 0o777))
      modeChanges.push({ path: file.relativePath, mode: file.mode & 0o777 });
  }

  const instructions: ShiftInstruction[] = [];
  if (options.message)
    instructions.push({ type: 'MESSAGE', value: options.message, line: 0 });
  instructions.push({ type: 'BASE', hash: base.manifest.rootHash, line: 0 });

  const consumedAdded = new Set<string>();
  const consumedRemoved = new Set<string>();
  if (config.renameDetection) {
    const additionsByHash = new Map<string, CollectedFile[]>();
    for (const file of added) {
      const hash = currentHashes.get(file.relativePath);
      if (!hash) continue;
      const list = additionsByHash.get(hash) ?? [];
      list.push(file);
      additionsByHash.set(hash, list);
    }
    for (const oldFile of removed) {
      const candidates = additionsByHash.get(oldFile.sha256) ?? [];
      const candidate = candidates.find(
        (file) => !consumedAdded.has(file.relativePath),
      );
      if (!candidate) continue;
      consumedRemoved.add(oldFile.path);
      consumedAdded.add(candidate.relativePath);
      instructions.push({
        type: 'MOVE',
        from: oldFile.path,
        to: candidate.relativePath,
        expectedHash: oldFile.sha256,
        line: 0,
      });
      if ((oldFile.mode & 0o777) !== (candidate.mode & 0o777)) {
        instructions.push({
          type: 'CHMOD',
          path: candidate.relativePath,
          mode: candidate.mode & 0o777,
          line: 0,
        });
      }
    }
  }
  for (const oldFile of removed) {
    if (!consumedRemoved.has(oldFile.path))
      instructions.push({
        type: 'REMOVE',
        path: oldFile.path,
        expectedHash: oldFile.sha256,
        line: 0,
      });
  }
  for (const modeChange of modeChanges)
    instructions.push({
      type: 'CHMOD',
      path: modeChange.path,
      mode: modeChange.mode,
      line: 0,
    });

  const payloadFiles = [
    ...modified,
    ...added.filter((file) => !consumedAdded.has(file.relativePath)),
  ];
  const { manifest, data } = await createManifest(
    payloadFiles,
    config,
    'patch',
    base.manifest.rootHash,
    base.manifest.files,
  );
  const entries: ArchiveEntry[] = manifest.files.map((file) => ({
    path: file.path,
    data: data.get(file.path) as Buffer,
    mode: file.mode,
    mtime: file.mtime ? new Date(file.mtime) : undefined,
  }));
  entries.push({
    path: '.packageshift',
    data: Buffer.from(renderShift(instructions), 'utf8'),
    mode: 0o644,
  });
  entries.push({
    path: '.packagemanifest.json',
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    mode: 0o644,
  });
  await writeZip(outputPath, entries, {
    compressionLevel: config.compressionLevel,
    deterministic: config.deterministic,
  });

  if (!options.quiet) {
    console.log(`Created ${outputPath}`);
    console.log(
      `${payloadFiles.length} payload files, ${instructions.filter((item) => item.type !== 'BASE' && item.type !== 'MESSAGE').length} structural operations`,
    );
    console.log(`Base ${base.manifest.rootHash}`);
  }
  return outputPath;
}
