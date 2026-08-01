import path from 'node:path';
import { loadPackage } from '../manifest/load.js';
import { comparePackageToProject } from './compare.js';
import type { ProjectChange } from '../types.js';
import {
  changeSymbol,
  color,
  colorChangeKind,
  divider,
  label,
  section,
  symbol,
  warning,
} from '../util/terminal.js';

function octal(mode: number | undefined): string {
  return mode === undefined ? '---' : mode.toString(8).padStart(3, '0');
}

function countLabel(kind: string, count: number): string {
  return colorChangeKind(kind, `${count} ${kind.toLowerCase()}`);
}

export function formatChanges(changes: ProjectChange[]): string {
  const visible = changes.filter((change) => change.kind !== 'UNCHANGED');
  if (visible.length === 0)
    return `${color.positive(symbol.success)} ${color.green('No changes detected.')}`;

  const lines: string[] = [];
  for (const change of visible) {
    const marker = changeSymbol(change.kind);
    const kind = colorChangeKind(change.kind, change.kind.padEnd(8));
    if (change.kind === 'MOVE' || change.kind === 'COPY') {
      lines.push(`  ${marker} ${kind} ${color.light(change.path)}`);
      lines.push(
        `    ${color.muted(symbol.lastBranch)} ${color.magenta(symbol.arrow)} ${color.light(change.destination ?? '')}`,
      );
    } else if (change.kind === 'MODE') {
      lines.push(
        `  ${marker} ${kind} ${color.light(change.path)} ${color.muted(octal(change.beforeMode))} ${color.yellow(symbol.arrow)} ${color.yellow(octal(change.afterMode))}`,
      );
    } else {
      const detail = change.detail
        ? ` ${color.muted(`(${change.detail})`)}`
        : '';
      lines.push(`  ${marker} ${kind} ${color.light(change.path)}${detail}`);
    }
  }

  const counts = new Map<string, number>();
  for (const change of visible)
    counts.set(change.kind, (counts.get(change.kind) ?? 0) + 1);

  lines.push('');
  lines.push(`  ${divider(42)}`);
  lines.push(
    `  ${color.accent(`${visible.length} change${visible.length === 1 ? '' : 's'}`)} ${color.muted('·')} ${[
      ...counts.entries(),
    ]
      .map(([kind, count]) => countLabel(kind, count))
      .join(color.muted('  |  '))}`,
  );
  return lines.join('\n');
}

export async function diffCommand(
  archivePath: string,
  cwd: string,
  json = false,
): Promise<number> {
  const resolvedArchive = path.resolve(cwd, archivePath);
  const pkg = await loadPackage(resolvedArchive);
  const result = await comparePackageToProject(pkg, cwd);
  const visible = result.changes.filter(
    (change) => change.kind !== 'UNCHANGED',
  );
  if (json) {
    console.log(
      JSON.stringify(
        {
          archive: resolvedArchive,
          target: path.resolve(cwd),
          kind: pkg.manifest.kind,
          manifestSource: pkg.manifestSource,
          baseMatches: result.baseMatches,
          ignoredPayloadMetadataPaths: pkg.ignoredPayloadMetadataPaths,
          changes: visible,
        },
        null,
        2,
      ),
    );
  } else {
    section('Archive comparison');
    console.log(
      `${color.muted(symbol.branch)} ${label('Package')} ${color.bold(resolvedArchive)}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Target')} ${color.light(path.resolve(cwd))}`,
    );
    console.log(
      `${color.muted(symbol.branch)} ${label('Kind')} ${color.magenta(pkg.manifest.kind)}`,
    );
    console.log(
      `${color.muted(symbol.lastBranch)} ${label('Manifest')} ${color.blue(pkg.manifestSource)}`,
    );
    if (pkg.ignoredPayloadMetadataPaths.length > 0)
      warning(
        `reserved CLI metadata listed as payload was ignored: ${pkg.ignoredPayloadMetadataPaths.join(', ')}`,
      );
    if (pkg.manifestSource === 'generated')
      console.log(
        `${color.yellow(symbol.warning)} ${label('Safety')} ${color.yellow('no embedded manifest; base verification unavailable')}`,
      );
    if (result.baseMatches === false)
      console.log(
        `${color.red(symbol.error)} ${label('Base')} ${color.red('mismatch')} ${color.muted('(apply requires --force)')}`,
      );
    else if (result.baseMatches === true)
      console.log(
        `${color.green(symbol.success)} ${label('Base')} ${color.green('matches')}`,
      );
    console.log('');
    section('Changes');
    console.log(formatChanges(result.changes));
  }
  return visible.length === 0 ? 0 : 1;
}
