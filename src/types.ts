export type ArchiveType = 'zip';
export type CollectionStrategy = 'git' | 'walk';
export type ConflictStrategy = 'abort' | 'overwrite' | 'skip';
export type SensitiveFilesMode = 'warn' | 'error' | 'allow';

export interface PackageConfig {
  $schema?: string;
  type: ArchiveType;
  root: string;
  output: string;
  name: string;
  strategy: CollectionStrategy;
  gitignore: boolean;
  npmignore: boolean;
  include: string[];
  ignore: string[];
  dot: boolean;
  followSymlinks: boolean;
  includeEmptyDirectories: boolean;
  manifest: boolean;
  shiftFile: string;
  compressionLevel: number;
  deterministic: boolean;
  preserveMode: boolean;
  preserveMtime: boolean;
  sensitiveFiles: SensitiveFilesMode;
  backupOnApply: boolean;
  conflictStrategy: ConflictStrategy;
  renameDetection: boolean;
  renameThreshold: number;
  beforePackage: string[];
  afterPackage: string[];
  beforeApply: string[];
  afterApply: string[];
  deletePackageOnApply: boolean;
}

export interface ManifestFile {
  path: string;
  size: number;
  mode: number;
  mtime?: string;
  sha256: string;
}

export interface PackageManifest {
  schemaVersion: 1;
  kind: 'snapshot' | 'patch' | 'backup';
  project: string;
  createdAt: string;
  rootHash: string;
  baseRootHash?: string;
  baseFiles?: ManifestFile[];
  config: Pick<PackageConfig, 'strategy' | 'gitignore' | 'npmignore' | 'dot'>;
  files: ManifestFile[];
}

export interface CollectedFile {
  absolutePath: string;
  relativePath: string;
  size: number;
  mode: number;
  mtime: Date;
}

export type ShiftInstruction =
  | { type: 'MESSAGE'; value: string; line: number }
  | { type: 'BASE'; hash: string; line: number }
  | { type: 'REMOVE'; path: string; expectedHash?: string; line: number }
  | {
      type: 'MOVE';
      from: string;
      to: string;
      expectedHash?: string;
      line: number;
    }
  | { type: 'COPY'; from: string; to: string; line: number }
  | { type: 'REPLACE'; path: string; expectedHash?: string; line: number }
  | { type: 'CHMOD'; path: string; mode: number; line: number };

export interface ParsedShift {
  version: 1;
  instructions: ShiftInstruction[];
}

export type ChangeKind =
  | 'ADD'
  | 'MODIFY'
  | 'REMOVE'
  | 'MOVE'
  | 'COPY'
  | 'MODE'
  | 'UNCHANGED'
  | 'CONFLICT';

export interface ProjectChange {
  kind: ChangeKind;
  path: string;
  destination?: string;
  beforeHash?: string;
  afterHash?: string;
  beforeMode?: number;
  afterMode?: number;
  detail?: string;
}

export interface ArchiveEntry {
  path: string;
  data: Buffer;
  mode?: number;
  mtime?: Date;
  compression?: 'store' | 'deflate';
}

export interface ReadArchiveEntry {
  path: string;
  data: Buffer;
  mode: number;
  mtime: Date;
  isDirectory: boolean;
}

export type ManifestSource = 'embedded' | 'legacy' | 'generated';

export interface LoadedPackage {
  archivePath: string;
  manifest: PackageManifest;
  manifestSource: ManifestSource;
  shift?: ParsedShift;
  entries: Map<string, ReadArchiveEntry>;
}

export interface ApplyOptions {
  cwd: string;
  dryRun: boolean;
  yes: boolean;
  force: boolean;
  backup: boolean;
  conflictStrategy: ConflictStrategy;
  beforeApply?: string[];
  afterApply?: string[];
  deletePackageOnApply?: boolean;
}
