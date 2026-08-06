import { PackageError } from '../errors.js';
import type {
  ManifestComposition,
  ManifestFile,
  PackageManifest,
} from '../types.js';
import { sha256Buffer, stableJson } from '../util/hash.js';
import { normalizeRelativePath } from '../util/path.js';

const sha256Pattern = /^sha256:[0-9a-f]{64}$/i;

function invalid(sourcePath: string, message: string): never {
  throw new PackageError(`${sourcePath} ${message}`, 'MANIFEST_INVALID');
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && sha256Pattern.test(value);
}

function validateTimestamp(
  value: unknown,
  sourcePath: string,
  field: string,
): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Number.isNaN(Date.parse(value))
  )
    invalid(sourcePath, `contains an invalid ${field}.`);
}

function validateManifestFiles(
  value: unknown,
  sourcePath: string,
  field: string,
): ManifestFile[] {
  if (!Array.isArray(value))
    invalid(sourcePath, `contains an invalid ${field} array.`);

  const paths = new Set<string>();
  const portablePaths = new Set<string>();
  const files: ManifestFile[] = [];
  for (const [index, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
      invalid(sourcePath, `contains an invalid ${field}[${index}] entry.`);
    const file = candidate as Partial<ManifestFile>;
    if (
      typeof file.path !== 'string' ||
      !validHash(file.sha256) ||
      typeof file.size !== 'number' ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      typeof file.mode !== 'number' ||
      !Number.isInteger(file.mode) ||
      file.mode < 0 ||
      file.mode > 0o7777
    )
      invalid(sourcePath, `contains an invalid ${field}[${index}] entry.`);

    let normalized: string;
    try {
      normalized = normalizeRelativePath(file.path);
    } catch {
      invalid(sourcePath, `contains an unsafe ${field}[${index}] path.`);
    }
    if (normalized !== file.path)
      invalid(sourcePath, `contains a non-normalized ${field}[${index}] path.`);

    const portable = normalized.toLowerCase();
    if (paths.has(normalized) || portablePaths.has(portable))
      invalid(sourcePath, `contains duplicate ${field} path ${normalized}.`);
    paths.add(normalized);
    portablePaths.add(portable);

    if (file.mtime !== undefined)
      validateTimestamp(file.mtime, sourcePath, `${field}[${index}].mtime`);
    files.push(file as ManifestFile);
  }
  return files;
}

function validateMonorepo(manifest: PackageManifest, sourcePath: string): void {
  const monorepo = manifest.monorepo;
  if (monorepo === undefined) return;
  if (
    !monorepo ||
    typeof monorepo !== 'object' ||
    monorepo.root !== '.' ||
    typeof monorepo.includeRootFiles !== 'boolean' ||
    !Array.isArray(monorepo.workspaces)
  )
    invalid(sourcePath, 'contains invalid monorepo metadata.');

  const names = new Set<string>();
  const paths = new Set<string>();
  for (const workspace of monorepo.workspaces) {
    if (
      !workspace ||
      typeof workspace.name !== 'string' ||
      workspace.name.trim().length === 0 ||
      typeof workspace.path !== 'string' ||
      workspace.path.length === 0
    )
      invalid(sourcePath, 'contains an invalid monorepo workspace.');

    let normalized: string;
    try {
      normalized = normalizeRelativePath(workspace.path);
    } catch {
      invalid(sourcePath, 'contains an unsafe monorepo workspace path.');
    }
    if (
      normalized !== workspace.path ||
      paths.has(normalized) ||
      names.has(workspace.name)
    )
      invalid(
        sourcePath,
        'contains duplicate or non-normalized monorepo workspace metadata.',
      );
    paths.add(normalized);
    names.add(workspace.name);
  }
}

function assertAcyclicComposition(
  composition: ManifestComposition,
  sourcePath: string,
): void {
  const graph = new Map(
    composition.projects.map((project) => [project.name, project.dependsOn]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(name: string): void {
    if (visited.has(name)) return;
    if (visiting.has(name))
      invalid(sourcePath, 'contains a circular project composition graph.');
    visiting.add(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency);
    visiting.delete(name);
    visited.add(name);
  }

  for (const name of graph.keys()) visit(name);
}

function validateComposition(
  manifest: PackageManifest,
  sourcePath: string,
): void {
  const composition = manifest.composition;
  if (composition === undefined) return;
  if (manifest.monorepo !== undefined)
    invalid(
      sourcePath,
      'cannot contain both monorepo and project composition metadata.',
    );
  if (
    !composition ||
    typeof composition !== 'object' ||
    composition.root !== '.' ||
    typeof composition.entry !== 'string' ||
    composition.entry.trim().length === 0 ||
    !Array.isArray(composition.projects) ||
    composition.projects.length === 0
  )
    invalid(sourcePath, 'contains invalid project composition metadata.');

  const names = new Set<string>();
  const paths = new Set<string>();
  for (const project of composition.projects) {
    if (
      !project ||
      typeof project.name !== 'string' ||
      project.name.trim().length === 0 ||
      typeof project.path !== 'string' ||
      project.path.length === 0 ||
      !Array.isArray(project.dependsOn) ||
      !project.dependsOn.every(
        (dependency) =>
          typeof dependency === 'string' && dependency.trim().length > 0,
      ) ||
      (project.configPath !== undefined &&
        (typeof project.configPath !== 'string' ||
          project.configPath.length === 0))
    )
      invalid(sourcePath, 'contains an invalid composed project.');

    let normalizedPath: string;
    try {
      normalizedPath =
        project.path === '.' ? '.' : normalizeRelativePath(project.path);
      if (project.configPath !== undefined) {
        const normalizedConfig = normalizeRelativePath(project.configPath);
        if (normalizedConfig !== project.configPath) throw new Error();
      }
    } catch {
      invalid(sourcePath, 'contains an unsafe composed project path.');
    }
    if (
      normalizedPath !== project.path ||
      names.has(project.name) ||
      paths.has(normalizedPath) ||
      new Set(project.dependsOn).size !== project.dependsOn.length
    )
      invalid(
        sourcePath,
        'contains duplicate or non-normalized project composition metadata.',
      );
    names.add(project.name);
    paths.add(normalizedPath);
  }

  if (!names.has(composition.entry))
    invalid(sourcePath, 'project composition entry is missing.');
  for (const project of composition.projects) {
    for (const dependency of project.dependsOn) {
      if (!names.has(dependency) || dependency === project.name)
        invalid(
          sourcePath,
          'contains an invalid project dependency reference.',
        );
    }
  }
  assertAcyclicComposition(composition, sourcePath);
}

function validateSourcePackage(
  manifest: PackageManifest,
  sourcePath: string,
): void {
  const source = manifest.sourcePackage;
  if (source === undefined) return;
  if (
    !source ||
    typeof source !== 'object' ||
    typeof source.name !== 'string' ||
    source.name.length === 0 ||
    source.name.includes('/') ||
    source.name.includes('\\') ||
    !validHash(source.sha256)
  )
    invalid(sourcePath, 'contains invalid source package metadata.');
}

function validateConfigSummary(
  manifest: PackageManifest,
  sourcePath: string,
): void {
  const config = manifest.config;
  if (
    !config ||
    typeof config !== 'object' ||
    (config.strategy !== 'git' && config.strategy !== 'walk') ||
    typeof config.gitignore !== 'boolean' ||
    typeof config.npmignore !== 'boolean' ||
    typeof config.dot !== 'boolean'
  )
    invalid(sourcePath, 'contains invalid configuration metadata.');
}

export function validateManifest(
  value: unknown,
  sourcePath: string,
): PackageManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new PackageError(
      `${sourcePath} must contain an object.`,
      'MANIFEST_INVALID',
    );

  const manifest = value as Partial<PackageManifest>;
  if (manifest.schemaVersion !== 1)
    throw new PackageError(
      `Unsupported manifest schema version in ${sourcePath}.`,
      'MANIFEST_VERSION',
    );
  if (
    manifest.kind !== 'snapshot' &&
    manifest.kind !== 'patch' &&
    manifest.kind !== 'backup'
  )
    invalid(sourcePath, 'contains an invalid manifest kind.');
  if (
    typeof manifest.project !== 'string' ||
    manifest.project.trim().length === 0 ||
    !validHash(manifest.rootHash)
  )
    invalid(sourcePath, 'is missing required fields.');
  validateTimestamp(manifest.createdAt, sourcePath, 'createdAt');

  const complete = manifest as PackageManifest;
  const files = validateManifestFiles(complete.files, sourcePath, 'files');
  const expectedRootHash = sha256Buffer(Buffer.from(stableJson(files), 'utf8'));
  if (complete.rootHash !== expectedRootHash)
    throw new PackageError(
      `${sourcePath} root hash is invalid.`,
      'MANIFEST_INTEGRITY',
    );

  if (
    (complete.baseFiles === undefined) !==
    (complete.baseRootHash === undefined)
  )
    invalid(sourcePath, 'must provide baseFiles and baseRootHash together.');
  if (complete.baseFiles !== undefined) {
    const baseFiles = validateManifestFiles(
      complete.baseFiles,
      sourcePath,
      'baseFiles',
    );
    if (!validHash(complete.baseRootHash))
      invalid(sourcePath, 'contains an invalid baseRootHash.');
    const expectedBaseRootHash = sha256Buffer(
      Buffer.from(stableJson(baseFiles), 'utf8'),
    );
    if (complete.baseRootHash !== expectedBaseRootHash)
      throw new PackageError(
        `${sourcePath} base root hash is invalid.`,
        'MANIFEST_INTEGRITY',
      );
  }

  validateConfigSummary(complete, sourcePath);
  validateMonorepo(complete, sourcePath);
  validateComposition(complete, sourcePath);
  validateSourcePackage(complete, sourcePath);
  return complete;
}
