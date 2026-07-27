import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseArgs } from './args.js';
import { helpText } from './help.js';
import { loadConfig, resolveConfigPaths } from '../config.js';
import { createSnapshot } from '../commands/zip.js';
import { createShiftArchive } from '../commands/shift.js';
import { diffCommand } from '../commands/diff.js';
import { applyCommand } from '../commands/apply.js';
import {
  checkCommand,
  initCommand,
  inspectCommand,
  listCommand,
} from '../commands/meta.js';
import { PackageError } from '../errors.js';

async function readVersion(): Promise<string> {
  const candidates = [
    new URL('../../../package.json', import.meta.url),
    new URL('../../package.json', import.meta.url),
  ];
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(await readFile(candidate, 'utf8')) as {
        version?: string;
      };
      if (value.version) return value.version;
    } catch {
      // Try the next source/build layout.
    }
  }
  return '0.0.0';
}

function requirePositional(
  positionals: string[],
  index: number,
  label: string,
): string {
  const value = positionals[index];
  if (!value) throw new PackageError(`Missing ${label}.`, 'CLI_ARGUMENT');
  return value;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);
  if (args.command === 'help') {
    console.log(helpText);
    return;
  }
  if (args.command === 'version') {
    console.log(await readVersion());
    return;
  }

  const cwd = path.resolve(args.cwd);
  if (args.command === 'init') {
    await initCommand(cwd, args.force);
    return;
  }

  let projectCwd = cwd;
  if (args.command === 'zip' && args.positionals[0])
    projectCwd = path.resolve(cwd, args.positionals[0]);
  const loaded = await loadConfig(projectCwd, args.configPath);
  const merged = { ...loaded.config, ...args.configOverrides };
  if (args.configOverrides.ignore)
    merged.ignore = [...loaded.config.ignore, ...args.configOverrides.ignore];
  if (args.configOverrides.include)
    merged.include = args.configOverrides.include;
  const config = resolveConfigPaths(merged, projectCwd);

  if (args.command === 'zip') {
    await createSnapshot(config, { output: args.output, quiet: args.quiet });
  } else if (args.command === 'shift') {
    await createShiftArchive(
      requirePositional(args.positionals, 0, 'base archive'),
      config,
      {
        output: args.output,
        message: args.message,
        quiet: args.quiet,
      },
    );
  } else if (args.command === 'diff') {
    const exitCode = await diffCommand(
      requirePositional(args.positionals, 0, 'archive path'),
      config.root,
      args.json,
    );
    process.exitCode = exitCode;
  } else if (args.command === 'apply') {
    await applyCommand(requirePositional(args.positionals, 0, 'archive path'), {
      cwd: config.root,
      dryRun: args.dryRun,
      yes: args.yes,
      force: args.force,
      backup: args.backup ?? config.backupOnApply,
      conflictStrategy: args.conflictStrategy ?? config.conflictStrategy,
      beforeApply: config.beforeApply,
      afterApply: config.afterApply,
      deletePackageOnApply:
        args.deletePackageOnApply ?? config.deletePackageOnApply,
    });
  } else if (args.command === 'inspect') {
    await inspectCommand(
      requirePositional(args.positionals, 0, 'archive path'),
      config.root,
      args.json,
    );
  } else if (args.command === 'check') {
    await checkCommand(
      requirePositional(args.positionals, 0, 'archive path'),
      config.root,
    );
  } else if (args.command === 'list') {
    await listCommand(args.positionals[0], config, args.json);
  } else {
    throw new PackageError(`Unknown command: ${args.command}`, 'CLI_COMMAND');
  }
}
