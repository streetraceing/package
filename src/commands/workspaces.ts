import type { PackageConfig, WorkspacePackage } from '../types.js';
import {
  discoverWorkspaces,
  resolveWorkspaceScope,
} from '../workspaces/discover.js';
import {
  color,
  divider,
  label,
  section,
  symbol,
  statusPrefix,
} from '../util/terminal.js';

function localDependencies(
  workspace: WorkspacePackage,
  names: Set<string>,
): string[] {
  return workspace.dependencies.filter((dependency) => names.has(dependency));
}

export async function workspacesCommand(
  config: PackageConfig,
  json: boolean,
): Promise<void> {
  const discovery = await discoverWorkspaces(config);
  const scope =
    config.monorepo.selection.length > 0
      ? await resolveWorkspaceScope(config)
      : undefined;
  const selected = new Set(
    scope?.workspaces.map((workspace) => workspace.name) ?? [],
  );
  const names = new Set(
    discovery.workspaces.map((workspace) => workspace.name),
  );
  const workspaces = discovery.workspaces.map((workspace) => ({
    ...workspace,
    selected: Boolean(scope) && selected.has(workspace.name),
    localDependencies: localDependencies(workspace, names),
  }));

  if (json) {
    console.log(
      JSON.stringify(
        {
          root: config.root,
          mode: config.monorepo.mode,
          patterns: discovery.patterns,
          sources: discovery.sources,
          selected: scope?.workspaces.map((workspace) => workspace.name) ?? [],
          workspaces,
        },
        null,
        2,
      ),
    );
    return;
  }

  section('Monorepo workspaces');
  console.log(
    `${color.muted(symbol.branch)} ${label('Root')} ${color.light(config.root)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Detection')} ${color.blue(
      discovery.sources.length > 0 ? discovery.sources.join(', ') : 'none',
    )}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Patterns')} ${color.gray(
      discovery.patterns.length > 0 ? discovery.patterns.join(', ') : 'none',
    )}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Workspaces')} ${color.green(
      String(discovery.workspaces.length),
    )}`,
  );
  for (const workspace of workspaces) {
    const marker = workspace.selected
      ? statusPrefix('success')
      : statusPrefix('info');
    const version = workspace.version
      ? ` ${color.muted(symbol.separator)} ${color.gray(workspace.version)}`
      : '';
    const privacy = workspace.private
      ? ` ${color.muted(symbol.separator)} ${color.yellow('private')}`
      : '';
    const dependencies =
      workspace.localDependencies.length > 0
        ? ` ${color.muted(symbol.separator)} ${color.magenta(
            `depends on ${workspace.localDependencies.join(', ')}`,
          )}`
        : '';
    console.log(
      `${marker} ${color.bold(workspace.name)} ` +
        `${color.muted(symbol.arrow)} ${color.cyan(workspace.path)}` +
        `${version}${privacy}${dependencies}`,
    );
  }
  console.log(color.muted(divider(58)));
}
