import type {
  CollectedFile,
  PackageConfig,
  PackageManifest,
  ShiftInstruction,
} from '../types.js';
import { sha256File } from '../util/hash.js';

function packagedMode(file: CollectedFile, config: PackageConfig): number {
  return (file.preserveMode ?? config.preserveMode) ? file.mode & 0o777 : 0o644;
}

export interface CalculatedShift {
  instructions: ShiftInstruction[];
  payloadFiles: CollectedFile[];
  currentHashes: Map<string, string>;
  structuralOperations: number;
}

export async function calculateShift(
  baseManifest: PackageManifest,
  currentFiles: CollectedFile[],
  config: PackageConfig,
  message?: string,
): Promise<CalculatedShift> {
  const currentByPath = new Map(
    currentFiles.map((file) => [file.relativePath, file]),
  );
  const baseByPath = new Map(
    baseManifest.files.map((file) => [file.path, file]),
  );
  const currentHashes = new Map<string, string>();
  for (const file of currentFiles)
    currentHashes.set(file.relativePath, await sha256File(file.absolutePath));

  const removed = baseManifest.files.filter(
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
    else if (packagedMode(file, config) !== (previous.mode & 0o777))
      modeChanges.push({
        path: file.relativePath,
        mode: packagedMode(file, config),
      });
  }

  const instructions: ShiftInstruction[] = [];
  if (message) instructions.push({ type: 'MESSAGE', value: message, line: 0 });
  instructions.push({ type: 'BASE', hash: baseManifest.rootHash, line: 0 });

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
      if ((oldFile.mode & 0o777) !== packagedMode(candidate, config)) {
        instructions.push({
          type: 'CHMOD',
          path: candidate.relativePath,
          mode: packagedMode(candidate, config),
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
  const structuralOperations = instructions.filter(
    (instruction) =>
      instruction.type !== 'BASE' && instruction.type !== 'MESSAGE',
  ).length;

  return {
    instructions,
    payloadFiles,
    currentHashes,
    structuralOperations,
  };
}
