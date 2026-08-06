import path from 'node:path';
import { loadPackage } from '../manifest/load.js';
import { collectConfiguredProjects } from '../projects/collect.js';
import type { PackageConfig } from '../types.js';
import {
  color,
  divider,
  label,
  section,
  success,
  symbol,
  statusPrefix,
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
  if (pkg.manifest.composition) {
    console.log(
      `${color.muted(symbol.branch)} ${label('Entry project')} ${color.cyan(pkg.manifest.composition.entry)}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Project composition')} ${color.magenta(
        pkg.manifest.composition.projects
          .map((project) => {
            const dependencies =
              project.dependsOn.length > 0
                ? ` -> ${project.dependsOn.join(', ')}`
                : '';
            return `${project.name} (${project.path})${dependencies}`;
          })
          .join(', '),
      )}`,
    );
  }
  if (pkg.manifest.monorepo) {
    console.log(
      `${color.muted(symbol.branch)} ${label('Workspace scope')} ${color.magenta(
        pkg.manifest.monorepo.workspaces
          .map((workspace) => `${workspace.name} (${workspace.path})`)
          .join(', '),
      )}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Root shared files')} ${
        pkg.manifest.monorepo.includeRootFiles
          ? color.green('included')
          : color.yellow('excluded')
      }`,
    );
  }
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
      `${statusPrefix('info')} ${color.light(`No manifest found; validated as a .packageshift archive with ${pkg.manifest.files.length} payload ${fileWord}.`)}`,
    );
  } else if (pkg.manifestSource === 'legacy') {
    console.log(
      `${statusPrefix('success')} ${color.light(`${pkg.manifest.files.length} payload ${fileWord} verified using legacy .packagemanifest metadata`)}`,
    );
  } else {
    console.log(
      `${statusPrefix('success')} ${color.light(`${pkg.manifest.files.length} payload ${fileWord} verified`)}`,
    );
  }
  if (pkg.shift) {
    const instructionWord =
      pkg.shift.instructions.length === 1 ? 'instruction' : 'instructions';
    console.log(
      `${statusPrefix('success')} ${color.light(`${pkg.shift.instructions.length} .packageshift ${instructionWord} parsed`)}`,
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
    paths = (await collectConfiguredProjects(config)).files.map(
      (file) => file.relativePath,
    );
  }
  if (json) console.log(JSON.stringify(paths, null, 2));
  else for (const filePath of paths) console.log(filePath);
}
