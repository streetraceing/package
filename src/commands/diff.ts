import path from 'node:path';
import { loadPackage } from '../manifest/load.js';
import { comparePackageToProject } from './compare.js';
import type { ProjectChange } from '../types.js';

function octal(mode: number | undefined): string {
  return mode === undefined ? '---' : mode.toString(8).padStart(3, '0');
}

export function formatChanges(changes: ProjectChange[]): string {
  const visible = changes.filter((change) => change.kind !== 'UNCHANGED');
  if (visible.length === 0) return 'No changes.';
  const lines: string[] = [];
  for (const change of visible) {
    if (change.kind === 'MOVE' || change.kind === 'COPY') {
      lines.push(`  ${change.kind.padEnd(8)} ${change.path}`);
      lines.push(`           -> ${change.destination ?? ''}`);
    } else if (change.kind === 'MODE') {
      lines.push(`  MODE     ${change.path} ${octal(change.beforeMode)} -> ${octal(change.afterMode)}`);
    } else {
      lines.push(`  ${change.kind.padEnd(8)} ${change.path}${change.detail ? ` (${change.detail})` : ''}`);
    }
  }
  const counts = new Map<string, number>();
  for (const change of visible) counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);
  lines.push('', `${visible.length} change${visible.length === 1 ? '' : 's'}`);
  lines.push([...counts.entries()].map(([kind, count]) => `${count} ${kind.toLowerCase()}`).join(', '));
  return lines.join('\n');
}

export async function diffCommand(archivePath: string, cwd: string, json = false): Promise<number> {
  const resolvedArchive = path.resolve(cwd, archivePath);
  const pkg = await loadPackage(resolvedArchive);
  const result = await comparePackageToProject(pkg, cwd);
  const visible = result.changes.filter((change) => change.kind !== 'UNCHANGED');
  if (json) {
    console.log(JSON.stringify({
      archive: resolvedArchive,
      target: path.resolve(cwd),
      kind: pkg.manifest.kind,
      baseMatches: result.baseMatches,
      changes: visible,
    }, null, 2));
  } else {
    console.log(`Package: ${resolvedArchive}`);
    console.log(`Target:  ${path.resolve(cwd)}`);
    console.log(`Kind:    ${pkg.manifest.kind}`);
    if (result.baseMatches === false) console.log('Base:    mismatch (apply requires --force)');
    else if (result.baseMatches === true) console.log('Base:    matches');
    console.log('');
    console.log(formatChanges(result.changes));
  }
  return visible.length === 0 ? 0 : 1;
}
