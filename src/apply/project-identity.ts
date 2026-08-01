import path from 'node:path';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import type { ApplyOptions, LoadedPackage } from '../types.js';
import { PackageError } from '../errors.js';
import {
  color,
  divider,
  label,
  section,
  symbol,
  warning,
} from '../util/terminal.js';
import { packagePayloadFiles } from '../archive/metadata.js';
import { resolveInside } from '../util/path.js';

interface PackageJsonIdentity {
  name?: string;
}

export interface ProjectMismatch {
  archiveProject?: string;
  archivePackageName?: string;
  targetProject: string;
  targetPackageName?: string;
  reasons: string[];
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase();
}

function identifierVariants(value: string): Set<string> {
  const normalized = normalizeIdentifier(value);
  const unscoped = normalized.includes('/')
    ? (normalized.split('/').at(-1) ?? normalized)
    : normalized;
  return new Set([normalized, unscoped]);
}

function identifiersMatch(left: string, right: string): boolean {
  const leftVariants = identifierVariants(left);
  return [...identifierVariants(right)].some((item) => leftVariants.has(item));
}

function parsePackageName(data: Buffer | string): string | undefined {
  try {
    const parsed = JSON.parse(data.toString()) as PackageJsonIdentity;
    return typeof parsed.name === 'string' && parsed.name.trim().length > 0
      ? parsed.name.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

async function targetHasProjectFiles(root: string): Promise<boolean> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.some((entry) => {
      if (entry.name === '.git' || entry.name === '.package-backups')
        return false;
      return !entry.name.toLowerCase().endsWith('.zip');
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function hasPayloadPathOverlap(
  pkg: LoadedPackage,
  root: string,
): Promise<boolean> {
  for (const file of packagePayloadFiles(pkg.manifest.files)) {
    try {
      await lstat(resolveInside(root, file.path));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return false;
}

async function targetPackageName(root: string): Promise<string | undefined> {
  try {
    return parsePackageName(await readFile(path.join(root, 'package.json')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

export async function detectProjectMismatch(
  pkg: LoadedPackage,
  projectRoot: string,
  baseMatches?: boolean,
): Promise<ProjectMismatch | undefined> {
  // A verified patch base is stronger evidence than directory/package names.
  if (baseMatches === true) return undefined;

  const archivePackageName = pkg.entries.has('package.json')
    ? parsePackageName(pkg.entries.get('package.json')?.data ?? '')
    : undefined;
  const targetName = await targetPackageName(projectRoot);
  const targetProject = path.basename(path.resolve(projectRoot));
  const archiveProject =
    pkg.manifestSource === 'generated' ? undefined : pkg.manifest.project;
  const reasons: string[] = [];

  if (
    archivePackageName &&
    targetName &&
    !identifiersMatch(archivePackageName, targetName)
  ) {
    reasons.push(
      `package.json names differ (${archivePackageName} vs ${targetName})`,
    );
  }

  const packageNamesProveMatch =
    archivePackageName &&
    targetName &&
    identifiersMatch(archivePackageName, targetName);
  const archiveProjectDiffers =
    archiveProject &&
    !identifiersMatch(archiveProject, targetProject) &&
    (!targetName || !identifiersMatch(archiveProject, targetName));
  if (!packageNamesProveMatch && archiveProjectDiffers) {
    const [hasOverlap, hasTargetFiles] = await Promise.all([
      hasPayloadPathOverlap(pkg, projectRoot),
      targetHasProjectFiles(projectRoot),
    ]);
    if (targetName || (hasTargetFiles && !hasOverlap)) {
      reasons.push(
        `archive project "${archiveProject}" does not match target "${targetProject}"`,
      );
    }
  }

  return reasons.length > 0
    ? {
        archiveProject,
        archivePackageName,
        targetProject,
        targetPackageName: targetName,
        reasons,
      }
    : undefined;
}

function printMismatch(mismatch: ProjectMismatch): void {
  section('Project mismatch');
  warning('this archive appears to belong to a different project.');
  if (mismatch.archiveProject)
    console.log(
      `${color.muted(symbol.branch)} ${label('Archive project')} ${color.magenta(mismatch.archiveProject)}`,
    );
  if (mismatch.archivePackageName)
    console.log(
      `${color.muted(symbol.branch)} ${label('Archive package')} ${color.magenta(mismatch.archivePackageName)}`,
    );
  console.log(
    `${color.muted(symbol.branch)} ${label('Target project')} ${color.cyan(mismatch.targetProject)}`,
  );
  if (mismatch.targetPackageName)
    console.log(
      `${color.muted(symbol.lastBranch)} ${label('Target package')} ${color.cyan(mismatch.targetPackageName)}`,
    );
  for (const reason of mismatch.reasons)
    console.log(`  ${color.yellow(symbol.warning)} ${color.yellow(reason)}`);
  console.log(color.muted(divider(44)));
}

export async function confirmProjectMismatch(
  mismatch: ProjectMismatch | undefined,
  options: ApplyOptions,
): Promise<void> {
  if (!mismatch) return;
  printMismatch(mismatch);

  if (options.dryRun) {
    warning(
      'dry-run will continue without writing files. A real apply will require explicit confirmation.',
    );
    return;
  }

  if (options.allowProjectMismatch) {
    warning('project mismatch was explicitly allowed by the command line.');
    return;
  }

  if (options.yes || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new PackageError(
      'Refusing to apply an archive that appears to target another project. Review with --dry-run and pass --allow-project-mismatch only when intentional.',
      'PROJECT_MISMATCH',
    );
  }

  const readline = createInterface({ input, output });
  try {
    const answer = await readline.question(
      `Type the target project name "${mismatch.targetProject}" to continue: `,
    );
    if (answer.trim() !== mismatch.targetProject) {
      throw new PackageError('Apply cancelled.', 'APPLY_CANCELLED');
    }
  } finally {
    readline.close();
  }
}
