import { PackageError } from '../errors.js';
import type { LoadedPackage, PackageManifest } from '../types.js';
import { readZip } from '../archive/zip.js';
import { parseShift } from '../shift/parser.js';
import { sha256Buffer, stableJson } from '../util/hash.js';

function validateManifest(value: unknown): PackageManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PackageError('.packagemanifest.json must contain an object.', 'MANIFEST_INVALID');
  }
  const manifest = value as Partial<PackageManifest>;
  if (manifest.schemaVersion !== 1) throw new PackageError('Unsupported manifest schema version.', 'MANIFEST_VERSION');
  if (manifest.kind !== 'snapshot' && manifest.kind !== 'patch' && manifest.kind !== 'backup') {
    throw new PackageError('Invalid manifest kind.', 'MANIFEST_INVALID');
  }
  if (typeof manifest.project !== 'string' || typeof manifest.rootHash !== 'string' || !Array.isArray(manifest.files)) {
    throw new PackageError('Manifest is missing required fields.', 'MANIFEST_INVALID');
  }
  for (const file of manifest.files) {
    if (!file || typeof file.path !== 'string' || typeof file.sha256 !== 'string' || typeof file.size !== 'number' || typeof file.mode !== 'number') {
      throw new PackageError('Manifest contains an invalid file entry.', 'MANIFEST_INVALID');
    }
  }
  const expectedRootHash = sha256Buffer(Buffer.from(stableJson(manifest.files), 'utf8'));
  if (manifest.rootHash !== expectedRootHash) throw new PackageError('Manifest root hash is invalid.', 'MANIFEST_INTEGRITY');
  return manifest as PackageManifest;
}

export async function loadPackage(archivePath: string): Promise<LoadedPackage> {
  const entries = await readZip(archivePath);
  const manifestEntry = entries.get('.packagemanifest.json');
  if (!manifestEntry) throw new PackageError('Archive does not contain .packagemanifest.json.', 'MANIFEST_MISSING');
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestEntry.data.toString('utf8'));
  } catch (error) {
    throw new PackageError(`Cannot parse .packagemanifest.json: ${(error as Error).message}`, 'MANIFEST_INVALID');
  }
  const manifest = validateManifest(parsed);
  for (const file of manifest.files) {
    const entry = entries.get(file.path);
    if (!entry) throw new PackageError(`Archive is missing manifest file: ${file.path}`, 'ARCHIVE_INCOMPLETE');
    if (entry.data.length !== file.size || sha256Buffer(entry.data) !== file.sha256) {
      throw new PackageError(`Archive file failed integrity check: ${file.path}`, 'ARCHIVE_INTEGRITY');
    }
  }
  const shiftEntry = entries.get('.packageshift');
  const shift = shiftEntry ? parseShift(shiftEntry.data.toString('utf8'), '.packageshift') : undefined;
  return { archivePath, manifest, shift, entries };
}
