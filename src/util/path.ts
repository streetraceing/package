import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { PackageError } from '../errors.js';

export function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/');
}

export function normalizeRelativePath(value: string): string {
  const posix = toPosixPath(value).replace(/^\.\//, '');
  if (!posix || posix === '.') {
    throw new PackageError(
      'An empty project-relative path is not allowed.',
      'UNSAFE_PATH',
    );
  }
  if (posix.startsWith('/') || /^[A-Za-z]:\//.test(posix)) {
    throw new PackageError(
      `Absolute path is not allowed: ${value}`,
      'UNSAFE_PATH',
    );
  }
  const normalized = path.posix.normalize(posix);
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new PackageError(
      `Path escapes the project root: ${value}`,
      'UNSAFE_PATH',
    );
  }
  if (normalized.includes('\0')) {
    throw new PackageError(
      `NUL bytes are not allowed in paths: ${value}`,
      'UNSAFE_PATH',
    );
  }
  return normalized;
}

export function resolveInside(root: string, relativePath: string): string {
  const safe = normalizeRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...safe.split('/'));
  const relation = path.relative(resolvedRoot, resolved);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    throw new PackageError(
      `Path escapes the project root: ${relativePath}`,
      'UNSAFE_PATH',
    );
  }
  return resolved;
}

export async function assertNoSymlinkAncestors(
  root: string,
  relativePath: string,
): Promise<void> {
  const safe = normalizeRelativePath(relativePath);
  const segments = safe.split('/');
  let current = path.resolve(root);
  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        throw new PackageError(
          `Refusing to traverse symbolic link: ${path.relative(root, current)}`,
          'SYMLINK_PATH',
        );
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

export function isDotPath(relativePath: string): boolean {
  return normalizeRelativePath(relativePath)
    .split('/')
    .some(
      (segment) =>
        segment.startsWith('.') && segment !== '.' && segment !== '..',
    );
}
