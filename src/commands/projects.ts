import path from 'node:path';
import type { PackageConfig } from '../types.js';
import { resolveProjectComposition } from '../projects/composition.js';
import { color, divider, label, section, symbol } from '../util/terminal.js';

export async function projectsCommand(
  config: PackageConfig,
  json: boolean,
): Promise<void> {
  const composition = await resolveProjectComposition(config);
  if (json) {
    console.log(
      JSON.stringify(
        composition ?? {
          root: config.root,
          entry: path.basename(config.root),
          projects: [
            {
              name: path.basename(config.root),
              root: config.root,
              archivePath: '.',
              dependsOn: [],
            },
          ],
        },
        null,
        2,
      ),
    );
    return;
  }

  section('Project composition');
  if (!composition) {
    console.log(
      `${color.muted(symbol.branch)} ${label('Entry')} ${color.cyan(path.basename(config.root))}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Root')} ${color.light(config.root)}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Dependencies')} ${color.gray('none')}`,
    );
    console.log(color.muted(divider(44)));
    return;
  }

  console.log(
    `${color.muted(symbol.branch)} ${label('Entry')} ${color.cyan(composition.entry)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Archive root')} ${color.light(composition.root)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Projects')} ${color.magenta(String(composition.projects.length))}`,
  );
  for (const project of composition.projects) {
    const relation =
      project.dependsOn.length > 0
        ? `depends on ${project.dependsOn.join(', ')}`
        : 'no dependencies';
    console.log(
      `${color.muted(symbol.branch)} ${color.blue(symbol.info)} ${color.bold(project.name)} ${color.muted(symbol.arrow)} ${color.light(project.archivePath)} ${color.muted(`│ ${relation}`)}`,
    );
  }
  console.log(color.muted(divider(44)));
}
