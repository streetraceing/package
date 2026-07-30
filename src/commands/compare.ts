import { lstat, readFile } from 'node:fs/promises';
import type {
  LoadedPackage,
  ProjectChange,
  ShiftInstruction,
} from '../types.js';
import { sha256Buffer } from '../util/hash.js';
import { resolveInside } from '../util/path.js';
import { packagePayloadFiles } from '../archive/metadata.js';
import {
  readCurrentManifestFiles,
  rootHashForFiles,
} from '../manifest/state.js';

async function fileState(
  root: string,
  relativePath: string,
): Promise<{ hash: string; mode: number } | undefined> {
  try {
    const absolutePath = resolveInside(root, relativePath);
    const stat = await lstat(absolutePath);
    if (!stat.isFile()) return undefined;
    return {
      hash: sha256Buffer(await readFile(absolutePath)),
      mode: stat.mode & 0o777,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function instructionToChange(
  root: string,
  instruction: ShiftInstruction,
): Promise<ProjectChange | undefined> {
  if (instruction.type === 'REMOVE') {
    const current = await fileState(root, instruction.path);
    if (!current) return { kind: 'UNCHANGED', path: instruction.path };
    if (instruction.expectedHash && current.hash !== instruction.expectedHash)
      return {
        kind: 'CONFLICT',
        path: instruction.path,
        beforeHash: current.hash,
        detail: `expected ${instruction.expectedHash}, current ${current.hash}`,
      };
    return { kind: 'REMOVE', path: instruction.path, beforeHash: current.hash };
  }
  if (instruction.type === 'MOVE') {
    const source = await fileState(root, instruction.from);
    const destination = await fileState(root, instruction.to);
    if (source) {
      if (instruction.expectedHash && source.hash !== instruction.expectedHash)
        return {
          kind: 'CONFLICT',
          path: instruction.from,
          destination: instruction.to,
          beforeHash: source.hash,
          detail: `expected ${instruction.expectedHash}, current ${source.hash}`,
        };
      return {
        kind: 'MOVE',
        path: instruction.from,
        destination: instruction.to,
        beforeHash: source.hash,
      };
    }
    if (
      destination &&
      (!instruction.expectedHash ||
        destination.hash === instruction.expectedHash)
    )
      return { kind: 'UNCHANGED', path: instruction.to };
    return {
      kind: 'CONFLICT',
      path: instruction.from,
      destination: instruction.to,
      detail: 'move source is missing',
    };
  }
  if (instruction.type === 'COPY') {
    const source = await fileState(root, instruction.from);
    const destination = await fileState(root, instruction.to);
    if (!source)
      return {
        kind: 'CONFLICT',
        path: instruction.from,
        destination: instruction.to,
        detail: 'copy source is missing',
      };
    if (!destination)
      return {
        kind: 'COPY',
        path: instruction.from,
        destination: instruction.to,
        beforeHash: source.hash,
      };
    if (destination.hash === source.hash)
      return { kind: 'UNCHANGED', path: instruction.to };
    return {
      kind: 'CONFLICT',
      path: instruction.to,
      detail: 'copy destination differs',
    };
  }
  if (instruction.type === 'CHMOD') {
    const current = await fileState(root, instruction.path);
    if (!current)
      return {
        kind: 'CONFLICT',
        path: instruction.path,
        detail: 'chmod target is missing',
      };
    return current.mode === instruction.mode
      ? { kind: 'UNCHANGED', path: instruction.path }
      : {
          kind: 'MODE',
          path: instruction.path,
          beforeMode: current.mode,
          afterMode: instruction.mode,
        };
  }
  return undefined;
}

export async function comparePackageToProject(
  pkg: LoadedPackage,
  root: string,
): Promise<{ changes: ProjectChange[]; baseMatches?: boolean }> {
  const changes: ProjectChange[] = [];
  const expectedPayloadHashes = new Map<string, string>();
  for (const instruction of pkg.shift?.instructions ?? []) {
    if (instruction.type === 'REPLACE' && instruction.expectedHash)
      expectedPayloadHashes.set(instruction.path, instruction.expectedHash);
  }
  for (const file of packagePayloadFiles(pkg.manifest.files)) {
    const current = await fileState(root, file.path);
    const expectedHash = expectedPayloadHashes.get(file.path);
    if (current && expectedHash && current.hash !== expectedHash) {
      changes.push({
        kind: 'CONFLICT',
        path: file.path,
        beforeHash: current.hash,
        afterHash: file.sha256,
        beforeMode: current.mode,
        afterMode: file.mode,
        detail: `expected ${expectedHash}, current ${current.hash}`,
      });
    } else if (!current) {
      changes.push({
        kind: 'ADD',
        path: file.path,
        afterHash: file.sha256,
        afterMode: file.mode,
      });
    } else if (current.hash !== file.sha256) {
      changes.push({
        kind: 'MODIFY',
        path: file.path,
        beforeHash: current.hash,
        afterHash: file.sha256,
        beforeMode: current.mode,
        afterMode: file.mode,
      });
    } else if (current.mode !== file.mode) {
      changes.push({
        kind: 'MODE',
        path: file.path,
        beforeHash: current.hash,
        afterHash: file.sha256,
        beforeMode: current.mode,
        afterMode: file.mode,
      });
    } else {
      changes.push({
        kind: 'UNCHANGED',
        path: file.path,
        beforeHash: current.hash,
        afterHash: file.sha256,
        beforeMode: current.mode,
        afterMode: file.mode,
      });
    }
  }
  for (const instruction of pkg.shift?.instructions ?? []) {
    const change = await instructionToChange(root, instruction);
    if (change) changes.push(change);
  }
  let baseMatches: boolean | undefined;
  if (pkg.manifest.baseFiles && pkg.manifest.baseRootHash) {
    const currentBaseFiles = await readCurrentManifestFiles(
      root,
      pkg.manifest.baseFiles,
    );
    baseMatches =
      rootHashForFiles(currentBaseFiles) === pkg.manifest.baseRootHash;
  }
  return { changes, baseMatches };
}
