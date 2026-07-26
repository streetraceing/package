import path from 'node:path';
import { access, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { loadPackage } from '../manifest/load.js';
import { exampleConfig } from '../config.js';
import { collectFiles } from '../files/collect.js';
import type { PackageConfig } from '../types.js';
import { PackageError } from '../errors.js';

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
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(`Archive: ${path.resolve(cwd, archivePath)}`);
  console.log(`Kind: ${pkg.manifest.kind}`);
  console.log(`Manifest: ${pkg.manifestSource}`);
  console.log(`Project: ${pkg.manifest.project}`);
  console.log(`Created: ${pkg.manifest.createdAt}`);
  console.log(`Files: ${pkg.manifest.files.length}`);
  console.log(`Structural operations: ${operations}`);
  console.log(`Root: ${pkg.manifest.rootHash}`);
  if (pkg.manifest.baseRootHash)
    console.log(`Base: ${pkg.manifest.baseRootHash}`);
}

export async function checkCommand(
  archivePath: string,
  cwd: string,
): Promise<void> {
  const pkg = await loadPackage(path.resolve(cwd, archivePath));
  console.log(`OK ${path.resolve(cwd, archivePath)}`);
  const fileWord = pkg.manifest.files.length === 1 ? 'file' : 'files';
  if (pkg.manifestSource === 'generated') {
    console.log(
      `No manifest found; validated as a .packageshift archive with ${pkg.manifest.files.length} payload ${fileWord}.`,
    );
  } else if (pkg.manifestSource === 'legacy') {
    console.log(
      `${pkg.manifest.files.length} payload ${fileWord} verified using legacy .packagemanifest metadata`,
    );
  } else {
    console.log(`${pkg.manifest.files.length} payload ${fileWord} verified`);
  }
  if (pkg.shift) {
    const instructionWord =
      pkg.shift.instructions.length === 1 ? 'instruction' : 'instructions';
    console.log(
      `${pkg.shift.instructions.length} .packageshift ${instructionWord} parsed`,
    );
  }
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

export async function initCommand(cwd: string, force: boolean): Promise<void> {
  const target = path.resolve(cwd, '.packagerc');
  if (!force) {
    try {
      await access(target, constants.F_OK);
      throw new PackageError(
        `${target} already exists. Pass --force to overwrite it.`,
        'CONFIG_EXISTS',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await writeFile(target, exampleConfig, 'utf8');
  console.log(`Created ${target}`);
}
