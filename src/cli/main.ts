import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parseArgs } from './args.js';
import { helpText } from './help.js';
import { loadConfig } from '../config.js';
import { resolveEffectiveConfig } from './configuration.js';
import { createSnapshot } from '../commands/zip.js';
import { createShiftArchive } from '../commands/shift.js';
import { diffCommand } from '../commands/diff.js';
import { applyCommand } from '../commands/apply.js';
import { checkCommand, inspectCommand, listCommand } from '../commands/meta.js';
import { initCommand } from '../commands/init.js';
import { configCommand } from '../commands/config.js';
import { PackageError } from '../errors.js';
import { backupCommand } from '../commands/backups.js';
import { metadataCommand } from '../commands/metadata.js';
import { colorizeHelp } from '../util/terminal.js';
import { workspacesCommand } from '../commands/workspaces.js';
import { projectsCommand } from '../commands/projects.js';
import { resolveProjectComposition } from '../projects/composition.js';

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
    console.log(colorizeHelp(helpText));
    return;
  }
  if (args.command === 'version') {
    console.log(await readVersion());
    return;
  }

  const cwd = path.resolve(args.cwd);
  if (args.command === 'init') {
    await initCommand(cwd, {
      force: args.force,
      full: args.initFull,
      saveDeletedCache: args.saveDeletedCache,
      strategy: args.configOverrides.strategy,
      gitignore: args.configOverrides.gitignore,
      updateGitignore: args.configOverrides.gitignore !== false,
      packageManager: args.configOverrides.packageManager,
    });
    return;
  }

  const projectCwd =
    args.command === 'zip' && args.positionals[0]
      ? path.resolve(cwd, args.positionals[0])
      : cwd;
  const loaded = await loadConfig(projectCwd, args.configPath);
  const commandWorkspaceSelectors =
    args.command === 'workspaces'
      ? [...args.workspaceSelectors, ...args.positionals]
      : args.workspaceSelectors;
  const config = resolveEffectiveConfig(
    loaded,
    args,
    commandWorkspaceSelectors,
  );

  switch (args.command) {
    case 'zip':
      await createSnapshot(config, { output: args.output, quiet: args.quiet });
      return;
    case 'shift':
      await createShiftArchive(
        requirePositional(args.positionals, 0, 'base archive'),
        config,
        {
          output: args.output,
          message: args.message,
          quiet: args.quiet,
        },
      );
      return;
    case 'diff':
      process.exitCode = await diffCommand(
        requirePositional(args.positionals, 0, 'archive path'),
        config.root,
        args.json,
      );
      return;
    case 'apply': {
      const composition = await resolveProjectComposition(config);
      await applyCommand(
        requirePositional(args.positionals, 0, 'archive path'),
        {
          cwd: config.root,
          ...(composition ? { composition } : {}),
          dryRun: args.dryRun,
          yes: args.yes,
          force: args.force,
          allowProjectMismatch: args.allowProjectMismatch,
          rewriteAll: args.rewriteAll,
          backup: args.backup ?? config.backupOnApply,
          conflictStrategy: args.conflictStrategy ?? config.conflictStrategy,
          beforeApply: config.beforeApply,
          afterApply: config.afterApply,
          packageManager: config.packageManager,
          deletePackageOnApply:
            args.deletePackageOnApply ?? config.deletePackageOnApply,
          deleteSourcePackageOnApply:
            args.deleteSourcePackageOnApply ??
            config.deleteSourcePackageOnApply,
          saveDeletedCache: args.saveDeletedCache ?? config.saveDeletedCache,
        },
      );
      return;
    }
    case 'metadata':
    case 'meta':
      await metadataCommand(args.positionals[0], config, {
        message: args.message,
        quiet: args.quiet,
      });
      return;
    case 'backup':
      await backupCommand(
        args.positionals[0],
        args.positionals[1],
        config.root,
        args.json,
        args.yes,
        args.saveDeletedCache ?? config.saveDeletedCache,
      );
      return;
    case 'inspect':
      await inspectCommand(
        requirePositional(args.positionals, 0, 'archive path'),
        config.root,
        args.json,
      );
      return;
    case 'check':
      await checkCommand(
        requirePositional(args.positionals, 0, 'archive path'),
        config.root,
      );
      return;
    case 'list':
      await listCommand(args.positionals[0], config, args.json);
      return;
    case 'workspaces':
      await workspacesCommand(config, args.json);
      return;
    case 'projects':
      await projectsCommand(config, args.json);
      return;
    case 'config':
      configCommand({
        config,
        configPath: loaded.configPath,
        json: args.json,
      });
      return;
    default:
      throw new PackageError(`Unknown command: ${args.command}`, 'CLI_COMMAND');
  }
}
