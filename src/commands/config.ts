import type { PackageConfig } from '../types.js';
import {
  color,
  divider,
  label,
  section,
  statusPrefix,
  symbol,
} from '../util/terminal.js';

export interface ConfigCommandContext {
  config: PackageConfig;
  configPath?: string;
  json?: boolean;
}

export function configCommand(context: ConfigCommandContext): void {
  const source = context.configPath ?? 'built-in defaults';
  if (context.json) {
    console.log(
      JSON.stringify(
        {
          source,
          config: context.config,
        },
        null,
        2,
      ),
    );
    return;
  }

  const { config } = context;
  section('Effective configuration');
  console.log(
    `${color.muted(symbol.branch)} ${label('Source')} ${color.light(source)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Root')} ${color.light(config.root)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Output')} ${color.light(config.output)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Archive')} ${color.cyan(config.name)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Collection')} ${color.magenta(config.strategy)} ${color.muted(`(${config.gitignore ? 'gitignore enabled' : 'gitignore disabled'})`)}`,
  );
  console.log(
    `${color.muted(symbol.branch)} ${label('Dependencies')} ${color.magenta(String(config.depends_on.length))}`,
  );
  const hooks =
    config.beforePackage.length +
    config.afterPackage.length +
    config.beforeApply.length +
    config.afterApply.length;
  console.log(
    `${statusPrefix('info')} ${label('Lifecycle hooks')} ${color.light(String(hooks))}`,
  );
  console.log(color.muted(divider(44)));
}
