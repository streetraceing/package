import path from 'node:path';
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
import {
  legacyPackageManifestPath,
  packageManifestPath,
  packageShiftPath,
  reservedPackageMetadataPaths,
} from '../archive/metadata.js';

function validateManifest(value: unknown, sourcePath: string): PackageManifest {
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
  return { archivePath, manifest, manifestSource, shift, entries };
}
