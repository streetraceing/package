import path from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import type { ArchiveEntry, PackageConfig } from '../types.js';
import { collectFiles } from '../files/collect.js';
import { findSensitiveFiles } from '../files/sensitive.js';
import { createManifest } from '../manifest/create.js';
import { writeZip } from '../archive/zip.js';
import { PackageError } from '../errors.js';

export interface ZipCommandOptions {
  output?: string;
  quiet?: boolean;
}

export function defaultArchivePath(config: PackageConfig): string {
  const folder = path.basename(config.root);
  const fileName = config.name.replaceAll('{folder}', folder);
  return path.resolve(config.output, fileName);
}

export async function createSnapshot(
  config: PackageConfig,
  options: ZipCommandOptions = {},
): Promise<string> {
  const archivePath = options.output
    ? path.resolve(config.root, options.output)
    : defaultArchivePath(config);
  await mkdir(path.dirname(archivePath), { recursive: true });
  const files = await collectFiles(config, archivePath);
  const sensitive = findSensitiveFiles(files.map((file) => file.relativePath));
  if (sensitive.length > 0 && config.sensitiveFiles === 'error') {
    throw new PackageError(
      `Sensitive files would be included:\n${sensitive.map((file) => `  ${file}`).join('\n')}`,
      'SENSITIVE_FILES',
    );
  }
  if (
    sensitive.length > 0 &&
    config.sensitiveFiles === 'warn' &&
    !options.quiet
  ) {
    console.warn(
      `Warning: potentially sensitive files are included:\n${sensitive.map((file) => `  ${file}`).join('\n')}`,
    );
  }
  const { manifest, data } = await createManifest(files, config, 'snapshot');
  const entries: ArchiveEntry[] = [];
  for (const file of manifest.files) {
    const content = data.get(file.path);
    if (!content)
      throw new PackageError(
        `Cannot read collected file: ${file.path}`,
        'FILE_READ_ERROR',
      );
    entries.push({
      path: file.path,
      data: content,
      mode: file.mode,
      mtime: file.mtime ? new Date(file.mtime) : undefined,
    });
  }
  entries.push({
    path: '.packagemanifest.json',
    data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
    mode: 0o644,
    compression: 'deflate',
  });
  const shiftFile = files.find(
    (file) => file.relativePath === config.shiftFile,
  );
  if (shiftFile && config.shiftFile !== '.packageshift') {
    entries.push({
      path: '.packageshift',
      data: await readFile(shiftFile.absolutePath),
      mode: 0o644,
    });
  }
  await writeZip(archivePath, entries, {
    compressionLevel: config.compressionLevel,
    deterministic: config.deterministic,
  });
  if (!options.quiet) {
    const bytes = entries.reduce((sum, entry) => sum + entry.data.length, 0);
    console.log(`Created ${archivePath}`);
    console.log(
      `${manifest.files.length} files, ${bytes.toLocaleString('en-US')} source bytes`,
    );
    if (manifest.rootHash) console.log(`Root ${manifest.rootHash}`);
  }
  return archivePath;
}
