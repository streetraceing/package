import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { PackageError } from './errors.js';
import type { PackageConfig } from './types.js';

export const defaultConfig: PackageConfig = {
  type: 'zip',
  root: '.',
  output: '.',
  name: '{folder}.zip',
  strategy: 'git',
  gitignore: true,
  npmignore: false,
  include: ['**/*'],
  ignore: [],
  dot: true,
  followSymlinks: false,
  includeEmptyDirectories: false,
  manifest: true,
  shiftFile: '.packageshift',
  compressionLevel: 9,
  deterministic: true,
  preserveMode: true,
  preserveMtime: false,
  sensitiveFiles: 'warn',
  backupOnApply: true,
  conflictStrategy: 'abort',
  renameDetection: true,
  renameThreshold: 0.8,
};

function stripJsonComments(input: string): string {
  let output = '';
  let quote: string | undefined;
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? '';
    const next = input[index + 1] ?? '';
    if (quote) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < input.length && input[index] !== '\n') index += 1;
      output += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (
        index < input.length &&
        !(input[index] === '*' && input[index + 1] === '/')
      )
        index += 1;
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function parseLooseJson(input: string, sourceName: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    try {
      const withoutComments = stripJsonComments(input)
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, content: string) =>
          JSON.stringify(content.replace(/\\'/g, "'")),
        )
        .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3')
        .replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(withoutComments);
    } catch (error) {
      throw new PackageError(
        `Cannot parse ${sourceName}: ${(error as Error).message}`,
        'CONFIG_PARSE_ERROR',
      );
    }
  }
}

function validateConfig(
  value: unknown,
  sourceName: string,
): Partial<PackageConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PackageError(
      `${sourceName} must contain an object.`,
      'CONFIG_INVALID',
    );
  }
  const config = value as Record<string, unknown>;
  const arrayKeys = ['include', 'ignore'] as const;
  for (const key of arrayKeys) {
    if (
      config[key] !== undefined &&
      (!Array.isArray(config[key]) ||
        !(config[key] as unknown[]).every((item) => typeof item === 'string'))
    ) {
      throw new PackageError(
        `${sourceName}: ${key} must be an array of strings.`,
        'CONFIG_INVALID',
      );
    }
  }
  if (config.compressionLevel !== undefined) {
    const level = Number(config.compressionLevel);
    if (!Number.isInteger(level) || level < 0 || level > 9) {
      throw new PackageError(
        `${sourceName}: compressionLevel must be an integer from 0 to 9.`,
        'CONFIG_INVALID',
      );
    }
  }
  if (config.renameThreshold !== undefined) {
    const threshold = Number(config.renameThreshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
      throw new PackageError(
        `${sourceName}: renameThreshold must be between 0 and 1.`,
        'CONFIG_INVALID',
      );
    }
  }
  return config as Partial<PackageConfig>;
}

export async function loadConfig(
  cwd: string,
  explicitPath?: string,
): Promise<{ config: PackageConfig; configPath?: string }> {
  const candidates = explicitPath
    ? [path.resolve(cwd, explicitPath)]
    : [path.join(cwd, '.packagerc'), path.join(cwd, '.packagerc.json')];
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = validateConfig(parseLooseJson(raw, candidate), candidate);
      return { config: { ...defaultConfig, ...parsed }, configPath: candidate };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
  }
  return { config: { ...defaultConfig } };
}

export function resolveConfigPaths(
  config: PackageConfig,
  cwd: string,
): PackageConfig {
  const root = path.resolve(cwd, config.root);
  const output = path.resolve(root, config.output);
  return { ...config, root, output };
}

export const exampleConfig = `{
  // Archive settings
  type: "zip",
  output: ".",
  name: "{folder}.zip",

  // File collection
  strategy: "git",
  gitignore: true,
  npmignore: false,
  include: ["**/*"],
  ignore: ["dist/**", "coverage/**", "src/assets/**"],
  dot: true,
  followSymlinks: false,

  // Reproducibility and safety
  compressionLevel: 9,
  deterministic: true,
  preserveMode: true,
  preserveMtime: false,
  sensitiveFiles: "warn",
  backupOnApply: true,
  conflictStrategy: "abort"
}
`;
