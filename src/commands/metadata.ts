import path from 'node:path';
import { access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import type {
  PackageConfig,
  PackageManifest,
  ShiftInstruction,
} from '../types.js';
import { collectFiles } from '../files/collect.js';
import { createManifest } from '../manifest/create.js';
import { loadManifestFile, loadPackage } from '../manifest/load.js';
import { calculateShift } from '../shift/calculate.js';
import { renderShift } from '../shift/render.js';
import { sha256File } from '../util/hash.js';
import { PackageError } from '../errors.js';
import {
  packageManifestPath,
  packageShiftPath,
  legacyPackageManifestPath,
} from '../archive/metadata.js';
import {
  DeletedCacheSession,
  reportDeletedCache,
} from '../util/deleted-cache.js';
import {
  color,
  divider,
  label,
  section,
  success,
  symbol,
  warning,
} from '../util/terminal.js';

export interface MetadataCommandOptions {
  message?: string;
  quiet?: boolean;
}

interface MetadataBaseline {
  manifest: PackageManifest;
  sourceArchive?: string;
  label: string;
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function looksLikeManifestFile(target: string): boolean {
  const name = path.basename(target);
  return (
    name === packageManifestPath ||
    name === legacyPackageManifestPath ||
    path.extname(name).toLowerCase() === '.json'
  );
}

async function loadBaseline(
  baseSource: string | undefined,
  config: PackageConfig,
): Promise<MetadataBaseline | undefined> {
  if (baseSource) {
    const resolved = path.resolve(config.root, baseSource);
    if (looksLikeManifestFile(resolved)) {
      return {
        manifest: await loadManifestFile(resolved),
        label: resolved,
      };
    }
    const pkg = await loadPackage(resolved);
    return {
      manifest: pkg.manifest,
      sourceArchive: resolved,
      label: resolved,
    };
  }

  const existingManifest = path.join(config.root, packageManifestPath);
  if (!(await exists(existingManifest))) return undefined;
  return {
    manifest: await loadManifestFile(existingManifest),
    label: existingManifest,
  };
}

function assertSnapshotBaseline(baseline: MetadataBaseline): void {
  if (baseline.manifest.kind !== 'snapshot') {
    throw new PackageError(
      `Metadata baseline must be a snapshot, but ${baseline.label} is ${baseline.manifest.kind}.`,
      'BASE_NOT_SNAPSHOT',
    );
  }
}

function configWithoutLocalBaselineArchive(
  config: PackageConfig,
  baseline: MetadataBaseline | undefined,
): PackageConfig {
  if (!baseline?.sourceArchive) return config;
  const relative = path
    .relative(config.root, baseline.sourceArchive)
    .replaceAll('\\', '/');
  if (relative.startsWith('../') || path.isAbsolute(relative)) return config;
  return { ...config, ignore: [...config.ignore, relative] };
}

export async function metadataCommand(
  baseSource: string | undefined,
  config: PackageConfig,
  options: MetadataCommandOptions = {},
): Promise<void> {
  const baseline = await loadBaseline(baseSource, config);
  if (baseline) assertSnapshotBaseline(baseline);

  const collectionConfig = configWithoutLocalBaselineArchive(config, baseline);
  const files = await collectFiles(collectionConfig);
  const { manifest } = await createManifest(files, config, 'snapshot');

  let instructions: ShiftInstruction[] = [];
  let structuralOperations = 0;
  if (baseline) {
    const calculated = await calculateShift(
      baseline.manifest,
      files,
      config,
      options.message,
    );
    instructions = calculated.instructions;
    structuralOperations = calculated.structuralOperations;
    if (baseline.sourceArchive) {
      manifest.sourcePackage = {
        name: path.basename(baseline.sourceArchive),
        sha256: await sha256File(baseline.sourceArchive),
      };
    }
  } else if (options.message) {
    instructions = [{ type: 'MESSAGE', value: options.message, line: 0 }];
  }

  const manifestTarget = path.join(config.root, packageManifestPath);
  const shiftTarget = path.join(config.root, packageShiftPath);
  const deletedCache = config.saveDeletedCache
    ? new DeletedCacheSession(config.root, 'metadata')
    : undefined;
  if (deletedCache) {
    await deletedCache.cachePath(
      manifestTarget,
      'replace-metadata',
      packageManifestPath,
    );
    await deletedCache.cachePath(
      shiftTarget,
      'replace-metadata',
      packageShiftPath,
    );
  }

  await writeFile(
    manifestTarget,
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(shiftTarget, renderShift(instructions), 'utf8');
  reportDeletedCache(deletedCache, options.quiet);

  if (options.quiet) return;
  section('Metadata generated');
  success(`Created ${manifestTarget}`);
  success(`Created ${shiftTarget}`);
  console.log(
    `${color.muted(symbol.branch)} ${label('Manifest files')} ${color.green(String(manifest.files.length))}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Structural operations')} ${color.magenta(String(structuralOperations))}`,
  );
  if (baseline)
    console.log(
      `${color.muted(symbol.lastBranch)} ${label('Base')} ${color.cyan(baseline.manifest.rootHash)}`,
    );
  else
    warning(
      `no baseline was provided or found; ${packageShiftPath} contains no structural changes`,
    );
  console.log(color.muted(divider(44)));
}
