import type { ConflictStrategy, PackageConfig } from '../types.js';
import { PackageError } from '../errors.js';

export interface ParsedArgs {
  command: string;
  positionals: string[];
  cwd: string;
  configPath?: string;
  output?: string;
  json: boolean;
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  backup?: boolean;
  quiet: boolean;
  message?: string;
  conflictStrategy?: ConflictStrategy;
  configOverrides: Partial<PackageConfig>;
}

const commands = new Set([
  'zip',
  'shift',
  'diff',
  'apply',
  'inspect',
  'check',
  'list',
  'init',
  'help',
  'version',
]);

function takeValue(
  argv: string[],
  index: number,
  flag: string,
): { value: string; next: number } {
  const current = argv[index] ?? '';
  const equals = current.indexOf('=');
  if (equals !== -1) return { value: current.slice(equals + 1), next: index };
  const value = argv[index + 1];
  if (!value || value.startsWith('--'))
    throw new PackageError(`${flag} requires a value.`, 'CLI_ARGUMENT');
  return { value, next: index + 1 };
}

export function parseArgs(argv: string[]): ParsedArgs {
  const rawPositionals: string[] = [];
  const parsed: ParsedArgs = {
    command: 'help',
    positionals: [],
    cwd: process.cwd(),
    json: false,
    dryRun: false,
    yes: false,
    force: false,
    quiet: false,
    configOverrides: {},
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === '--') {
      rawPositionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith('-') || arg === '-') {
      rawPositionals.push(arg);
      continue;
    }
    if (arg === '--help' || arg === '-h') rawPositionals.unshift('help');
    else if (arg === '--version' || arg === '-v')
      rawPositionals.unshift('version');
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--yes' || arg === '-y') parsed.yes = true;
    else if (arg === '--force' || arg === '-f') parsed.force = true;
    else if (arg === '--backup') parsed.backup = true;
    else if (arg === '--no-backup') parsed.backup = false;
    else if (arg === '--quiet' || arg === '-q') parsed.quiet = true;
    else if (arg === '--gitignore') parsed.configOverrides.gitignore = true;
    else if (arg === '--no-gitignore') parsed.configOverrides.gitignore = false;
    else if (arg === '--npmignore') parsed.configOverrides.npmignore = true;
    else if (arg === '--no-npmignore') parsed.configOverrides.npmignore = false;
    else if (arg === '--dot') parsed.configOverrides.dot = true;
    else if (arg === '--no-dot') parsed.configOverrides.dot = false;
    else if (arg === '--follow-symlinks')
      parsed.configOverrides.followSymlinks = true;
    else if (arg === '--no-follow-symlinks')
      parsed.configOverrides.followSymlinks = false;
    else if (arg.startsWith('--cwd')) {
      const result = takeValue(argv, index, '--cwd');
      parsed.cwd = result.value;
      index = result.next;
    } else if (arg.startsWith('--config')) {
      const result = takeValue(argv, index, '--config');
      parsed.configPath = result.value;
      index = result.next;
    } else if (arg.startsWith('--output') || arg === '-o') {
      const result = takeValue(argv, index, '--output');
      parsed.output = result.value;
      index = result.next;
    } else if (arg.startsWith('--message')) {
      const result = takeValue(argv, index, '--message');
      parsed.message = result.value;
      index = result.next;
    } else if (arg.startsWith('--strategy')) {
      const result = takeValue(argv, index, '--strategy');
      if (result.value !== 'git' && result.value !== 'walk')
        throw new PackageError(
          '--strategy must be git or walk.',
          'CLI_ARGUMENT',
        );
      parsed.configOverrides.strategy = result.value;
      index = result.next;
    } else if (arg.startsWith('--ignore')) {
      const result = takeValue(argv, index, '--ignore');
      parsed.configOverrides.ignore = [
        ...(parsed.configOverrides.ignore ?? []),
        result.value,
      ];
      index = result.next;
    } else if (arg.startsWith('--include')) {
      const result = takeValue(argv, index, '--include');
      parsed.configOverrides.include = [
        ...(parsed.configOverrides.include ?? []),
        result.value,
      ];
      index = result.next;
    } else if (arg.startsWith('--compression-level')) {
      const result = takeValue(argv, index, '--compression-level');
      parsed.configOverrides.compressionLevel = Number(result.value);
      index = result.next;
    } else if (arg.startsWith('--conflict')) {
      const result = takeValue(argv, index, '--conflict');
      if (
        result.value !== 'abort' &&
        result.value !== 'overwrite' &&
        result.value !== 'skip'
      ) {
        throw new PackageError(
          '--conflict must be abort, overwrite, or skip.',
          'CLI_ARGUMENT',
        );
      }
      parsed.conflictStrategy = result.value;
      index = result.next;
    } else {
      throw new PackageError(`Unknown option: ${arg}`, 'CLI_ARGUMENT');
    }
  }

  if (rawPositionals.length === 0) return parsed;
  const first = rawPositionals[0] ?? '';
  const second = rawPositionals[1] ?? '';
  if (commands.has(first)) {
    parsed.command = first;
    parsed.positionals = rawPositionals.slice(1);
  } else if (commands.has(second)) {
    parsed.command = second;
    parsed.positionals = [first, ...rawPositionals.slice(2)];
  } else {
    throw new PackageError(`Unknown command: ${first}`, 'CLI_COMMAND');
  }
  return parsed;
}
