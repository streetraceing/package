import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { ArchiveEntry, PackageConfig } from '../types.js';
import { loadPackage } from '../manifest/load.js';
import { collectFiles } from '../files/collect.js';
import { createManifest } from '../manifest/create.js';
import { writeZip } from '../archive/zip.js';
import { renderShift } from '../shift/render.js';
import { sha256File } from '../util/hash.js';
import { calculateShift } from '../shift/calculate.js';
import { PackageError } from '../errors.js';
import { packageManifestPath, packageShiftPath } from '../archive/metadata.js';
import { runPackageHooks } from '../util/hooks.js';
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
} from '../util/terminal.js';

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
  const outputPath = options.output
    ? path.resolve(config.root, options.output)
    : path.resolve(config.output, `${path.basename(config.root)}-shift.zip`);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await runPackageHooks('beforePackage', config.beforePackage, {
    root: config.root,
    archivePath: outputPath,
    command: 'shift',
    packageManager: config.packageManager,
    quiet: options.quiet,
  });
  const base = await loadPackage(path.resolve(config.root, baseArchive));
  if (base.manifest.kind !== 'snapshot')
    throw new PackageError(
      'The base archive must be a snapshot created by package zip.',
      'BASE_NOT_SNAPSHOT',
    );
  const resolvedBaseArchive = path.resolve(config.root, baseArchive);
  const baseRelative = path
    .relative(config.root, resolvedBaseArchive)
    .replaceAll('\\', '/');
  const collectionConfig =
    !baseRelative.startsWith('../') && !path.isAbsolute(baseRelative)
      ? { ...config, ignore: [...config.ignore, baseRelative] }
      : config;
  const currentFiles = await collectFiles(collectionConfig, outputPath);
  const { instructions, payloadFiles, structuralOperations } =
    await calculateShift(base.manifest, currentFiles, config, options.message);
  const { manifest, data } = await createManifest(
    payloadFiles,
    config,
    'patch',
    base.manifest.rootHash,
    base.manifest.files,
  );
  manifest.sourcePackage = {
    name: path.basename(resolvedBaseArchive),
    sha256: await sha256File(resolvedBaseArchive),
  };
  const entries: ArchiveEntry[] = manifest.files.map((file) => ({
    path: file.path,
    data: data.get(file.path) as Buffer,
    mode: file.mode,
    mtime: file.mtime ? new Date(file.mtime) : undefined,
  }));
  entries.push({
    path: packageShiftPath,
    data: Buffer.from(renderShift(instructions), 'utf8'),
    mode: 0o644,
  });
  entries.push({
    path: packageManifestPath,
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    mode: 0o644,
  });
  const deletedCache = config.saveDeletedCache
    ? new DeletedCacheSession(config.root, 'shift', outputPath)
    : undefined;
  if (deletedCache)
    await deletedCache.cachePath(
      outputPath,
      'replace-output-archive',
      path.basename(outputPath),
    );
  await writeZip(outputPath, entries, {
    compressionLevel: config.compressionLevel,
    deterministic: config.deterministic,
  });
  reportDeletedCache(deletedCache, options.quiet);
  await runPackageHooks('afterPackage', config.afterPackage, {
    root: config.root,
    archivePath: outputPath,
    command: 'shift',
    packageManager: config.packageManager,
    quiet: options.quiet,
  });

  if (!options.quiet) {
    section('.packageshift archive created');
    success(`Created ${outputPath}`);
    console.log(
      `${color.muted(symbol.branch)} ${label('Payload files')} ${color.green(String(payloadFiles.length))}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Structural operations')} ${color.magenta(String(structuralOperations))}`,
    );
    console.log(
      `${color.muted(symbol.lastBranch)} ${label('Base')} ${color.cyan(base.manifest.rootHash)}`,
    );
    console.log(color.muted(divider(44)));
  }
  return outputPath;
}
