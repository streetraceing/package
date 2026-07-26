import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import type { CollectedFile, PackageConfig } from '../types.js';
import { PackageError } from '../errors.js';
import { isDotPath, toPosixPath } from '../util/path.js';
import { isIgnored, matchesGlob, parseIgnoreFile, type IgnoreRule } from './ignore.js';

const execFileAsync = promisify(execFile);
const hardIgnored = ['.git/**', '.git', 'node_modules/**', 'node_modules', '.package-backups/**', '.package-backups', '.packagemanifest.json'];

async function gitFiles(root: string): Promise<string[] | undefined> {
  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root });
    const { stdout } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      encoding: 'buffer',
      maxBuffer: 128 * 1024 * 1024,
    });
    return stdout.toString('utf8').split('\0').filter(Boolean).map(toPosixPath);
  } catch {
    return undefined;
  }
}

function passesPatterns(relativePath: string, config: PackageConfig, outputArchive?: string): boolean {
  if (hardIgnored.some((pattern) => matchesGlob(relativePath, pattern))) return false;
  if (outputArchive && path.resolve(config.root, relativePath) === path.resolve(outputArchive)) return false;
  if (!config.dot && isDotPath(relativePath)) return false;
  const included = config.include.length === 0 || config.include.some((pattern) => matchesGlob(relativePath, pattern));
  if (!included) return false;
  if (config.ignore.some((pattern) => matchesGlob(relativePath, pattern))) return false;
  return true;
}

async function collectWithGit(config: PackageConfig, outputArchive?: string): Promise<CollectedFile[] | undefined> {
  if (config.strategy !== 'git' || !config.gitignore) return undefined;
  const paths = await gitFiles(config.root);
  if (!paths) return undefined;
  const files: CollectedFile[] = [];
  for (const relativePath of paths.sort()) {
    if (!passesPatterns(relativePath, config, outputArchive)) continue;
    const absolutePath = path.join(config.root, ...relativePath.split('/'));
    let stat;
    try {
      stat = await lstat(absolutePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      if (!config.followSymlinks) continue;
      const resolved = await realpath(absolutePath);
      const relation = path.relative(config.root, resolved);
      if (relation.startsWith('..') || path.isAbsolute(relation)) {
        throw new PackageError(`Symbolic link points outside the project: ${relativePath}`, 'SYMLINK_OUTSIDE_ROOT');
      }
      stat = await lstat(resolved);
    }
    if (!stat.isFile()) continue;
    files.push({
      absolutePath,
      relativePath,
      size: stat.size,
      mode: stat.mode & 0o777,
      mtime: stat.mtime,
    });
  }
  return files;
}

async function loadIgnoreRules(directory: string, relativeDirectory: string, config: PackageConfig): Promise<IgnoreRule[]> {
  const rules: IgnoreRule[] = [];
  const names: string[] = [];
  if (config.gitignore) names.push('.gitignore');
  if (config.npmignore) names.push('.npmignore');
  for (const name of names) {
    try {
      const content = await readFile(path.join(directory, name), 'utf8');
      rules.push(...parseIgnoreFile(content, relativeDirectory));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return rules;
}

async function collectWithWalk(config: PackageConfig, outputArchive?: string): Promise<CollectedFile[]> {
  const files: CollectedFile[] = [];

  async function walk(directory: string, relativeDirectory: string, inheritedRules: IgnoreRule[]): Promise<void> {
    const localRules = [...inheritedRules, ...(await loadIgnoreRules(directory, relativeDirectory, config))];
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = toPosixPath(path.posix.join(relativeDirectory, entry.name));
      const absolutePath = path.join(directory, entry.name);
      const isDirectory = entry.isDirectory();
      if (hardIgnored.some((pattern) => matchesGlob(relativePath, pattern))) continue;
      if (isIgnored(relativePath, isDirectory, localRules)) continue;
      if (!config.dot && isDotPath(relativePath)) continue;
      if (outputArchive && path.resolve(absolutePath) === path.resolve(outputArchive)) continue;
      if (entry.isSymbolicLink()) {
        if (!config.followSymlinks) continue;
        const resolved = await realpath(absolutePath);
        const relation = path.relative(config.root, resolved);
        if (relation.startsWith('..') || path.isAbsolute(relation)) {
          throw new PackageError(`Symbolic link points outside the project: ${relativePath}`, 'SYMLINK_OUTSIDE_ROOT');
        }
        const stat = await lstat(resolved);
        if (stat.isDirectory()) await walk(resolved, relativePath, localRules);
        else if (stat.isFile() && passesPatterns(relativePath, config, outputArchive)) {
          files.push({ absolutePath: resolved, relativePath, size: stat.size, mode: stat.mode & 0o777, mtime: stat.mtime });
        }
      } else if (entry.isDirectory()) {
        await walk(absolutePath, relativePath, localRules);
      } else if (entry.isFile() && passesPatterns(relativePath, config, outputArchive)) {
        const stat = await lstat(absolutePath);
        files.push({ absolutePath, relativePath, size: stat.size, mode: stat.mode & 0o777, mtime: stat.mtime });
      }
    }
  }

  await walk(config.root, '', []);
  return files;
}

export async function collectFiles(config: PackageConfig, outputArchive?: string): Promise<CollectedFile[]> {
  const gitResult = await collectWithGit(config, outputArchive);
  const files = gitResult ?? (await collectWithWalk(config, outputArchive));
  const duplicates = new Set<string>();
  const seen = new Set<string>();
  for (const file of files) {
    const key = process.platform === 'win32' ? file.relativePath.toLowerCase() : file.relativePath;
    if (seen.has(key)) duplicates.add(file.relativePath);
    seen.add(key);
  }
  if (duplicates.size > 0) {
    throw new PackageError(`Duplicate archive paths detected: ${[...duplicates].join(', ')}`, 'DUPLICATE_PATH');
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}
