import path from 'node:path';
import { access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { loadPackage } from '../manifest/load.js';
import { exampleConfig } from '../config.js';
import { collectFiles } from '../files/collect.js';
import type { PackageConfig } from '../types.js';
import { PackageError } from '../errors.js';
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

export async function inspectCommand(
  archivePath: string,
  cwd: string,
  json: boolean,
): Promise<void> {
  const pkg = await loadPackage(path.resolve(cwd, archivePath));
  const operations =
    pkg.shift?.instructions.filter(
      (instruction) =>
        instruction.type !== 'MESSAGE' && instruction.type !== 'BASE',
    ).length ?? 0;
  if (json) {
    console.log(
      JSON.stringify(
        {
          manifest: pkg.manifest,
          manifestSource: pkg.manifestSource,
          structuralOperations: operations,
          ignoredPayloadMetadataPaths: pkg.ignoredPayloadMetadataPaths,
        },
        null,
        2,
      ),
    );
    return;
  }
  section('Archive details');
  console.log(
    `${color.muted(symbol.branch)} ${label('Archive')} ${color.bold(path.resolve(cwd, archivePath))}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Kind')} ${color.magenta(pkg.manifest.kind)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Manifest')} ${color.blue(pkg.manifestSource)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Project')} ${color.light(pkg.manifest.project)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Created')} ${color.gray(pkg.manifest.createdAt)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Files')} ${color.green(String(pkg.manifest.files.length))}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Structural operations')} ${color.magenta(String(operations))}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Root')} ${color.cyan(pkg.manifest.rootHash)}`,
  );
  if (pkg.manifest.baseRootHash)
    console.log(
      `${color.muted(symbol.branch)} ${label('Base')} ${color.cyan(pkg.manifest.baseRootHash)}`,
    );
  if (pkg.manifest.sourcePackage)
    console.log(
      `${color.muted(symbol.lastBranch)} ${label('Source package')} ${color.light(pkg.manifest.sourcePackage.name)} ${color.muted(`(${pkg.manifest.sourcePackage.sha256})`)}`,
    );
  console.log(color.muted(divider(44)));
  if (pkg.ignoredPayloadMetadataPaths.length > 0)
    warning(
      `reserved CLI metadata listed as payload was ignored: ${pkg.ignoredPayloadMetadataPaths.join(', ')}`,
    );
}

export async function checkCommand(
  archivePath: string,
  cwd: string,
): Promise<void> {
  const pkg = await loadPackage(path.resolve(cwd, archivePath));
  section('Archive check');
  success(`Valid archive: ${path.resolve(cwd, archivePath)}`);
  const fileWord = pkg.manifest.files.length === 1 ? 'file' : 'files';
  if (pkg.manifestSource === 'generated') {
    console.log(
      `${color.blue(symbol.info)} ${color.light(`No manifest found; validated as a .packageshift archive with ${pkg.manifest.files.length} payload ${fileWord}.`)}`,
    );
  } else if (pkg.manifestSource === 'legacy') {
    console.log(
      `${color.green(symbol.success)} ${color.light(`${pkg.manifest.files.length} payload ${fileWord} verified using legacy .packagemanifest metadata`)}`,
    );
  } else {
    console.log(
      `${color.green(symbol.success)} ${color.light(`${pkg.manifest.files.length} payload ${fileWord} verified`)}`,
    );
  }
  if (pkg.shift) {
    const instructionWord =
      pkg.shift.instructions.length === 1 ? 'instruction' : 'instructions';
    console.log(
      `${color.magenta(symbol.success)} ${color.light(`${pkg.shift.instructions.length} .packageshift ${instructionWord} parsed`)}`,
    );
  }
  if (pkg.ignoredPayloadMetadataPaths.length > 0)
    warning(
      `reserved CLI metadata listed as payload was ignored: ${pkg.ignoredPayloadMetadataPaths.join(', ')}`,
    );
  console.log(color.muted(divider(44)));
}

export async function listCommand(
  archivePath: string | undefined,
  config: PackageConfig,
  json: boolean,
): Promise<void> {
  let paths: string[];
  if (archivePath) {
    const pkg = await loadPackage(path.resolve(config.root, archivePath));
    paths = pkg.manifest.files.map((file) => file.path);
  } else {
    paths = (await collectFiles(config)).map((file) => file.relativePath);
  }
  if (json) console.log(JSON.stringify(paths, null, 2));
  else for (const filePath of paths) console.log(filePath);
}

async function initCacheEnabled(target: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(target, 'utf8')) as {
      saveDeletedCache?: unknown;
    };
    return parsed.saveDeletedCache !== false;
  } catch {
    return true;
  }
}

const generatedGitignoreMarker = '# Generated by @streetraceing/package';
const generatedGitignorePattern = '*.zip';

function updateGitignoreContent(content: string): string {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const hadFinalNewline = content.endsWith('\n');
  const lines = content.length === 0 ? [] : content.split(/\r?\n/);
  if (hadFinalNewline && lines.at(-1) === '') lines.pop();

  const markerIndex = lines.findIndex(
    (line) => line.trim() === generatedGitignoreMarker,
  );
  const patternIndex = lines.findIndex(
    (line) => line.trim() === generatedGitignorePattern,
  );

  if (markerIndex !== -1 && patternIndex !== -1) return content;
  if (markerIndex !== -1) {
    lines.splice(markerIndex + 1, 0, generatedGitignorePattern);
  } else if (patternIndex !== -1) {
    lines.splice(patternIndex, 0, generatedGitignoreMarker);
  } else {
    if (lines.length > 0 && lines.at(-1) !== '') lines.push('');
    lines.push(generatedGitignoreMarker, generatedGitignorePattern);
  }
  return `${lines.join(newline)}${newline}`;
}

async function ensurePackageGitignore(
  cwd: string,
  deletedCache: DeletedCacheSession | undefined,
): Promise<void> {
  const target = path.resolve(cwd, '.gitignore');
  let current = '';
  let existed = false;
  try {
    current = await readFile(target, 'utf8');
    existed = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const updated = updateGitignoreContent(current);
  if (updated === current) return;
  if (existed && deletedCache)
    await deletedCache.cachePath(target, 'replace-gitignore', '.gitignore');
  await writeFile(target, updated, 'utf8');
  success(`${existed ? 'Updated' : 'Created'} ${target}`);
}

export async function initCommand(
  cwd: string,
  force: boolean,
  saveDeletedCache?: boolean,
): Promise<void> {
  const target = path.resolve(cwd, '.packagerc');
  let exists = false;
  try {
    await access(target, constants.F_OK);
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (exists && !force) {
    throw new PackageError(
      `${target} already exists. Pass --force to overwrite it.`,
      'CONFIG_EXISTS',
    );
  }

  const deletedCacheEnabled =
    saveDeletedCache ?? (exists ? await initCacheEnabled(target) : true);
  const deletedCache = deletedCacheEnabled
    ? new DeletedCacheSession(cwd, 'init')
    : undefined;
  if (exists && deletedCache)
    await deletedCache.cachePath(target, 'replace-config', '.packagerc');

  section('Project initialization');
  await writeFile(target, exampleConfig, 'utf8');
  success(`Created ${target}`);
  await ensurePackageGitignore(cwd, deletedCache);
  reportDeletedCache(deletedCache);
  console.log(color.muted(divider(44)));
}
