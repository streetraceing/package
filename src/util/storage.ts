import path from 'node:path';
import { homedir } from 'node:os';
import { sha256Buffer } from './hash.js';

function normalizedProjectRoot(root: string): string {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function packageDataDirectory(): string {
  const override = process.env.STREETRACEING_PACKAGE_HOME;
  return override
    ? path.resolve(override)
    : path.join(homedir(), 'streetraceing', '.package');
}

export function projectStorageKey(root: string): string {
  const name =
    path
      .basename(path.resolve(root))
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project';
  const digest = sha256Buffer(
    Buffer.from(normalizedProjectRoot(root), 'utf8'),
  ).slice('sha256:'.length, 'sha256:'.length + 12);
  return `${name}-${digest}`;
}

export function isPathInside(parent: string, candidate: string): boolean {
  const relation = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relation === '' ||
    (!relation.startsWith('..') && !path.isAbsolute(relation))
  );
}
