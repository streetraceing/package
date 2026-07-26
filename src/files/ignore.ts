import path from 'node:path';
import { toPosixPath } from '../util/path.js';

export interface IgnoreRule {
  base: string;
  pattern: string;
  negated: boolean;
  directoryOnly: boolean;
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function globToRegex(pattern: string): RegExp {
  const normalized = toPosixPath(pattern).replace(/^\.\//, '');
  let source = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index] ?? '';
    const next = normalized[index + 1] ?? '';
    if (char === '*' && next === '*') {
      const after = normalized[index + 2] ?? '';
      if (after === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '[') {
      const close = normalized.indexOf(']', index + 1);
      if (close !== -1) {
        source += normalized.slice(index, close + 1);
        index = close;
      } else {
        source += '\\[';
      }
    } else {
      source += escapeRegex(char);
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesGlob(relativePath: string, pattern: string): boolean {
  const target = toPosixPath(relativePath).replace(/^\.\//, '');
  const normalizedPattern = toPosixPath(pattern).replace(/^\.\//, '');
  const regex = globToRegex(normalizedPattern);
  if (regex.test(target)) return true;
  if (!normalizedPattern.includes('/')) {
    return target
      .split('/')
      .some((segment) => globToRegex(normalizedPattern).test(segment));
  }
  return false;
}

export function parseIgnoreFile(content: string, base = ''): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }
    if (line.startsWith('\\#') || line.startsWith('\\!')) line = line.slice(1);
    const directoryOnly = line.endsWith('/');
    line = line.replace(/\/$/, '').replace(/^\//, '');
    if (!line) continue;
    rules.push({
      base: toPosixPath(base),
      pattern: line,
      negated,
      directoryOnly,
    });
  }
  return rules;
}

export function isIgnored(
  relativePath: string,
  isDirectory: boolean,
  rules: IgnoreRule[],
): boolean {
  const target = toPosixPath(relativePath).replace(/^\.\//, '');
  let ignored = false;
  for (const rule of rules) {
    const relativeToBase = rule.base
      ? path.posix.relative(rule.base, target)
      : target;
    if (relativeToBase.startsWith('../') || relativeToBase === '..') continue;
    const pattern = rule.pattern.includes('/')
      ? rule.pattern
      : `**/${rule.pattern}`;
    const directPattern = rule.pattern;
    const matched =
      matchesGlob(relativeToBase, directPattern) ||
      matchesGlob(relativeToBase, pattern) ||
      (rule.directoryOnly &&
        (relativeToBase === rule.pattern ||
          relativeToBase.startsWith(`${rule.pattern}/`)));
    if (
      matched &&
      (!rule.directoryOnly ||
        isDirectory ||
        relativeToBase.startsWith(`${rule.pattern}/`))
    ) {
      ignored = !rule.negated;
    }
  }
  return ignored;
}
