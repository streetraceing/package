import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import type { ArchiveEntry, PackageConfig } from '../types.js';
import { loadPackage } from '../manifest/load.js';
import { collectConfiguredProjects } from '../projects/collect.js';
import { createManifest } from '../manifest/create.js';
import { writeZip } from '../archive/zip.js';
import {
  manifestArchiveEntry,
  payloadArchiveEntries,
  shiftArchiveEntry,
} from '../archive/entries.js';
import { renderShift } from '../shift/render.js';
import { sha256File } from '../util/hash.js';
import { calculateShift } from '../shift/calculate.js';
import { PackageError } from '../errors.js';
import { runProjectHookTargets } from '../util/hooks.js';
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
import {
  resolveWorkspaceScope,
  workspaceArchiveLabel,
  workspaceScopeMatchesManifest,
} from '../workspaces/discover.js';
import {
  compositionMatchesManifest,
  projectHookTargets,
  resolveProjectComposition,
} from '../projects/composition.js';

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
  const resolvedBaseArchive = path.resolve(config.root, baseArchive);
  const base = await loadPackage(resolvedBaseArchive);
  if (base.manifest.kind !== 'snapshot')
    throw new PackageError(
      'The base archive must be a snapshot created by package zip.',
      'BASE_NOT_SNAPSHOT',
    );

  const composition = await resolveProjectComposition(config);
  if (!compositionMatchesManifest(composition, base.manifest.composition)) {
    throw new PackageError(
      'The local depends_on project graph does not match the base snapshot. Restore the original graph or create a new snapshot.',
      'PROJECT_COMPOSITION_MISMATCH',
    );
  }
  const workspaceScope = composition
    ? undefined
    : await resolveWorkspaceScope(config, base.manifest.monorepo);
  if (
    !composition &&
    !workspaceScopeMatchesManifest(workspaceScope, base.manifest.monorepo)
  ) {
    throw new PackageError(
      'Workspace selection does not match the base snapshot. Create a new snapshot for the requested workspace scope.',
      'WORKSPACE_SCOPE_MISMATCH',
    );
  }

  const archiveLabel = workspaceArchiveLabel(
    workspaceScope,
    path.basename(config.root),
  )
    .replace(/^@/, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-');
  const outputPath = options.output
    ? path.resolve(config.root, options.output)
    : path.resolve(config.output, `${archiveLabel}-shift.zip`);
  await mkdir(path.dirname(outputPath), { recursive: true });

  await runProjectHookTargets(
    'beforePackage',
    projectHookTargets(composition, 'beforePackage', config),
    {
      archivePath: outputPath,
      command: 'shift',
      quiet: options.quiet,
      compositionRoot: composition?.root ?? config.root,
    },
  );

  const baseRelative = path
    .relative(config.root, resolvedBaseArchive)
    .replaceAll('\\', '/');
  const collectionConfig =
    !baseRelative.startsWith('../') && !path.isAbsolute(baseRelative)
      ? { ...config, ignore: [...config.ignore, baseRelative] }
      : config;
  const collection = await collectConfiguredProjects(
    collectionConfig,
    outputPath,
    composition,
  );
  const currentFiles = collection.files;
  const { instructions, payloadFiles, structuralOperations } =
    await calculateShift(base.manifest, currentFiles, config, options.message);
  const { manifest, data } = await createManifest(
    payloadFiles,
    config,
    'patch',
    base.manifest.rootHash,
    base.manifest.files,
    workspaceScope,
    composition,
  );
  manifest.sourcePackage = {
    name: path.basename(resolvedBaseArchive),
    sha256: await sha256File(resolvedBaseArchive),
  };
  const entries: ArchiveEntry[] = payloadArchiveEntries(manifest, data);
  entries.push(shiftArchiveEntry(renderShift(instructions)));
  entries.push(manifestArchiveEntry(manifest));
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

  await runProjectHookTargets(
    'afterPackage',
    projectHookTargets(composition, 'afterPackage', config),
    {
      archivePath: outputPath,
      command: 'shift',
      quiet: options.quiet,
      compositionRoot: composition?.root ?? config.root,
    },
  );

  if (!options.quiet) {
    section('.packageshift archive created');
    success(`Created ${outputPath}`);
    console.log(
      `${color.muted(symbol.branch)} ${label('Payload files')} ${color.green(String(payloadFiles.length))}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Structural operations')} ${color.magenta(String(structuralOperations))}`,
    );
    if (composition)
      console.log(
        `${color.muted(symbol.branch)} ${label('Projects')} ${color.magenta(
          composition.projects.map((project) => project.name).join(', '),
        )}`,
      );
    if (workspaceScope)
      console.log(
        `${color.muted(symbol.branch)} ${label('Workspaces')} ${color.magenta(
          workspaceScope.workspaces
            .map((workspace) => workspace.name)
            .join(', '),
        )}`,
      );
    console.log(
      `${color.muted(symbol.branch)} ${label('Base')} ${color.cyan(base.manifest.rootHash)}`,
    );
    console.log(color.muted(divider(44)));
  }
  return outputPath;
}
