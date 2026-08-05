import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { PackageError } from '../errors.js';
import type {
  LoadedPackage,
  ManifestFile,
  ManifestSource,
  PackageManifest,
  ParsedShift,
  ReadArchiveEntry,
} from '../types.js';
import { readZip } from '../archive/zip.js';
import { parseShift } from '../shift/parser.js';
import { sha256Buffer, stableJson } from '../util/hash.js';
import { normalizeRelativePath } from '../util/path.js';
import {
  legacyPackageManifestPath,
  packageManifestPath,
  packageShiftPath,
  isReservedPackageMetadataPath,
  packagePayloadFiles,
  reservedPackageMetadataPaths,
} from '../archive/metadata.js';

export function validateManifest(
  value: unknown,
  sourcePath: string,
): PackageManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PackageError(
      `${sourcePath} must contain an object.`,
      'MANIFEST_INVALID',
    );
  }
  const manifest = value as Partial<PackageManifest>;
  if (manifest.schemaVersion !== 1)
    throw new PackageError(
      `Unsupported manifest schema version in ${sourcePath}.`,
      'MANIFEST_VERSION',
    );
  if (
    manifest.kind !== 'snapshot' &&
    manifest.kind !== 'patch' &&
    manifest.kind !== 'backup'
  ) {
    throw new PackageError(
      `Invalid manifest kind in ${sourcePath}.`,
      'MANIFEST_INVALID',
    );
  }
  if (
    typeof manifest.project !== 'string' ||
    typeof manifest.rootHash !== 'string' ||
    !Array.isArray(manifest.files)
  ) {
    throw new PackageError(
      `${sourcePath} is missing required fields.`,
      'MANIFEST_INVALID',
    );
  }
  if (manifest.monorepo !== undefined) {
    const monorepo = manifest.monorepo;
    if (
      !monorepo ||
      typeof monorepo !== 'object' ||
      monorepo.root !== '.' ||
      typeof monorepo.includeRootFiles !== 'boolean' ||
      !Array.isArray(monorepo.workspaces)
    ) {
      throw new PackageError(
        `${sourcePath} contains invalid monorepo metadata.`,
        'MANIFEST_INVALID',
      );
    }
    const paths = new Set<string>();
    for (const workspace of monorepo.workspaces) {
      if (
        !workspace ||
        typeof workspace.name !== 'string' ||
        workspace.name.length === 0 ||
        typeof workspace.path !== 'string' ||
        workspace.path.length === 0
      ) {
        throw new PackageError(
          `${sourcePath} contains an invalid monorepo workspace.`,
          'MANIFEST_INVALID',
        );
      }
      let normalized: string;
      try {
        normalized = normalizeRelativePath(workspace.path);
      } catch {
        throw new PackageError(
          `${sourcePath} contains an unsafe monorepo workspace path.`,
          'MANIFEST_INVALID',
        );
      }
      if (normalized !== workspace.path || paths.has(normalized)) {
        throw new PackageError(
          `${sourcePath} contains duplicate or non-normalized monorepo workspace paths.`,
          'MANIFEST_INVALID',
        );
      }
      paths.add(normalized);
    }
  }

  if (manifest.composition !== undefined) {
    const composition = manifest.composition;
    if (
      !composition ||
      typeof composition !== 'object' ||
      composition.root !== '.' ||
      typeof composition.entry !== 'string' ||
      composition.entry.length === 0 ||
      !Array.isArray(composition.projects) ||
      composition.projects.length === 0
    ) {
      throw new PackageError(
        `${sourcePath} contains invalid project composition metadata.`,
        'MANIFEST_INVALID',
      );
    }
    if (manifest.monorepo !== undefined) {
      throw new PackageError(
        `${sourcePath} cannot contain both monorepo and project composition metadata.`,
        'MANIFEST_INVALID',
      );
    }
    const names = new Set<string>();
    const paths = new Set<string>();
    for (const project of composition.projects) {
      if (
        !project ||
        typeof project.name !== 'string' ||
        project.name.length === 0 ||
        typeof project.path !== 'string' ||
        project.path.length === 0 ||
        !Array.isArray(project.dependsOn) ||
        !project.dependsOn.every(
          (dependency) =>
            typeof dependency === 'string' && dependency.length > 0,
        ) ||
        (project.configPath !== undefined &&
          (typeof project.configPath !== 'string' ||
            project.configPath.length === 0))
      ) {
        throw new PackageError(
          `${sourcePath} contains an invalid composed project.`,
          'MANIFEST_INVALID',
        );
      }
      let normalizedPath: string;
      try {
        normalizedPath =
          project.path === '.' ? '.' : normalizeRelativePath(project.path);
        if (project.configPath !== undefined) {
          const normalizedConfig = normalizeRelativePath(project.configPath);
          if (normalizedConfig !== project.configPath) throw new Error();
        }
      } catch {
        throw new PackageError(
          `${sourcePath} contains an unsafe composed project path.`,
          'MANIFEST_INVALID',
        );
      }
      if (
        normalizedPath !== project.path ||
        names.has(project.name) ||
        paths.has(normalizedPath) ||
        new Set(project.dependsOn).size !== project.dependsOn.length
      ) {
        throw new PackageError(
          `${sourcePath} contains duplicate or non-normalized project composition metadata.`,
          'MANIFEST_INVALID',
        );
      }
      names.add(project.name);
      paths.add(normalizedPath);
    }
    if (!names.has(composition.entry)) {
      throw new PackageError(
        `${sourcePath} project composition entry is missing.`,
        'MANIFEST_INVALID',
      );
    }
    for (const project of composition.projects) {
      for (const dependency of project.dependsOn) {
        if (!names.has(dependency) || dependency === project.name) {
          throw new PackageError(
            `${sourcePath} contains an invalid project dependency reference.`,
            'MANIFEST_INVALID',
          );
        }
      }
    }
  }

  if (manifest.sourcePackage !== undefined) {
    const source = manifest.sourcePackage;
    if (
      !source ||
      typeof source !== 'object' ||
      typeof source.name !== 'string' ||
      source.name.length === 0 ||
      source.name !== path.basename(source.name) ||
      typeof source.sha256 !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/i.test(source.sha256)
    ) {
      throw new PackageError(
        `${sourcePath} contains invalid source package metadata.`,
        'MANIFEST_INVALID',
      );
    }
  }
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      typeof file.sha256 !== 'string' ||
      typeof file.size !== 'number' ||
      typeof file.mode !== 'number'
    ) {
      throw new PackageError(
        `${sourcePath} contains an invalid file entry.`,
        'MANIFEST_INVALID',
      );
    }
  }
  const expectedRootHash = sha256Buffer(
    Buffer.from(stableJson(manifest.files), 'utf8'),
  );
  if (manifest.rootHash !== expectedRootHash)
    throw new PackageError(
      `${sourcePath} root hash is invalid.`,
      'MANIFEST_INTEGRITY',
    );
  return manifest as PackageManifest;
}

export async function loadManifestFile(
  manifestPath: string,
): Promise<PackageManifest> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
    throw new PackageError(
      `Cannot parse ${manifestPath}: ${(error as Error).message}`,
      'MANIFEST_INVALID',
    );
  }
  return validateManifest(parsed, manifestPath);
}

function parseManifestEntry(
  entry: ReadArchiveEntry,
  sourcePath: string,
): PackageManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.data.toString('utf8'));
  } catch (error) {
    throw new PackageError(
      `Cannot parse ${sourcePath}: ${(error as Error).message}`,
      'MANIFEST_INVALID',
    );
  }
  return validateManifest(parsed, sourcePath);
}

function parseShiftEntry(
  entries: Map<string, ReadArchiveEntry>,
): ParsedShift | undefined {
  const shiftEntry = entries.get(packageShiftPath);
  return shiftEntry
    ? parseShift(shiftEntry.data.toString('utf8'), packageShiftPath)
    : undefined;
}

function generatedManifest(
  archivePath: string,
  entries: Map<string, ReadArchiveEntry>,
): PackageManifest {
  const files: ManifestFile[] = [...entries.values()]
    .filter(
      (entry) =>
        !entry.isDirectory && !reservedPackageMetadataPaths.has(entry.path),
    )
    .map((entry) => ({
      path: entry.path,
      size: entry.data.length,
      mode: entry.mode & 0o777,
      mtime: entry.mtime.toISOString(),
      sha256: sha256Buffer(entry.data),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  return {
    schemaVersion: 1,
    kind: 'patch',
    project: path.basename(archivePath, path.extname(archivePath)),
    createdAt: new Date(0).toISOString(),
    rootHash: sha256Buffer(Buffer.from(stableJson(files), 'utf8')),
    config: {
      strategy: 'walk',
      gitignore: false,
      npmignore: false,
      dot: true,
    },
    files,
  };
}

function sanitizeManifestPayload(manifest: PackageManifest): {
  manifest: PackageManifest;
  ignoredPaths: string[];
} {
  const files = packagePayloadFiles(manifest.files);
  const baseFiles = manifest.baseFiles
    ? packagePayloadFiles(manifest.baseFiles)
    : undefined;
  const ignoredPaths = [...manifest.files, ...(manifest.baseFiles ?? [])]
    .filter((file) => isReservedPackageMetadataPath(file.path))
    .map((file) => file.path)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort();
  const filesChanged = files.length !== manifest.files.length;
  const baseFilesChanged =
    manifest.baseFiles !== undefined &&
    baseFiles !== undefined &&
    baseFiles.length !== manifest.baseFiles.length;

  if (!filesChanged && !baseFilesChanged) return { manifest, ignoredPaths };

  return {
    manifest: {
      ...manifest,
      files,
      ...(filesChanged
        ? { rootHash: sha256Buffer(Buffer.from(stableJson(files), 'utf8')) }
        : {}),
      ...(baseFilesChanged && baseFiles
        ? {
            baseFiles,
            baseRootHash: sha256Buffer(
              Buffer.from(stableJson(baseFiles), 'utf8'),
            ),
          }
        : {}),
    },
    ignoredPaths,
  };
}

function verifyPayload(
  manifest: PackageManifest,
  entries: Map<string, ReadArchiveEntry>,
): void {
  for (const file of manifest.files) {
    const entry = entries.get(file.path);
    if (!entry)
      throw new PackageError(
        `Archive is missing manifest file: ${file.path}`,
        'ARCHIVE_INCOMPLETE',
      );
    if (
      entry.data.length !== file.size ||
      sha256Buffer(entry.data) !== file.sha256
    ) {
      throw new PackageError(
        `Archive file failed integrity check: ${file.path}`,
        'ARCHIVE_INTEGRITY',
      );
    }
  }
}

export async function loadPackage(archivePath: string): Promise<LoadedPackage> {
  const entries = await readZip(archivePath);
  const shift = parseShiftEntry(entries);

  const embeddedManifest = entries.get(packageManifestPath);
  const legacyManifest = entries.get(legacyPackageManifestPath);
  let manifest: PackageManifest;
  let manifestSource: ManifestSource;

  if (embeddedManifest) {
    manifest = parseManifestEntry(embeddedManifest, packageManifestPath);
    manifestSource = 'embedded';
  } else if (legacyManifest) {
    manifest = parseManifestEntry(legacyManifest, legacyPackageManifestPath);
    manifestSource = 'legacy';
  } else if (shift) {
    manifest = generatedManifest(archivePath, entries);
    manifestSource = 'generated';
  } else {
    throw new PackageError(
      `Archive must contain ${packageManifestPath}, ${legacyPackageManifestPath}, or ${packageShiftPath}.`,
      'PACKAGE_METADATA_MISSING',
    );
  }

  verifyPayload(manifest, entries);
  const sanitized = sanitizeManifestPayload(manifest);
  return {
    archivePath,
    manifest: sanitized.manifest,
    manifestSource,
    shift,
    entries,
    ignoredPayloadMetadataPaths: sanitized.ignoredPaths,
  };
}
