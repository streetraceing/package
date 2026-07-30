import type { ManifestFile } from '../types.js';
import { normalizeRelativePath } from '../util/path.js';

export const packageManifestPath = '.packagemanifest.json';
export const legacyPackageManifestPath = '.packagemanifest';
export const packageShiftPath = '.packageshift';

export const reservedPackageMetadataPaths = new Set([
  packageManifestPath,
  legacyPackageManifestPath,
  packageShiftPath,
]);

export function isReservedPackageMetadataPath(value: string): boolean {
  try {
    return reservedPackageMetadataPaths.has(normalizeRelativePath(value));
  } catch {
    return false;
  }
}

export function packagePayloadFiles(files: ManifestFile[]): ManifestFile[] {
  return files.filter((file) => !isReservedPackageMetadataPath(file.path));
}
