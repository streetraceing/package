import test from 'node:test';
import assert from 'node:assert/strict';
import type { ManifestFile, PackageManifest } from '../src/types.js';
import { validateManifest } from '../src/manifest/validate.js';
import { sha256Buffer, stableJson } from '../src/util/hash.js';

function manifest(
  files: ManifestFile[],
  overrides: Partial<PackageManifest> = {},
): PackageManifest {
  return {
    schemaVersion: 1,
    kind: 'snapshot',
    project: 'project',
    createdAt: '2026-08-07T00:00:00.000Z',
    rootHash: sha256Buffer(Buffer.from(stableJson(files), 'utf8')),
    config: {
      strategy: 'walk',
      gitignore: false,
      npmignore: false,
      dot: true,
    },
    files,
    ...overrides,
  };
}

function file(path: string): ManifestFile {
  const data = Buffer.from(path, 'utf8');
  return {
    path,
    size: data.length,
    mode: 0o644,
    sha256: sha256Buffer(data),
  };
}

test('manifest validation rejects duplicate portable paths', () => {
  const files = [file('src/App.ts'), file('src/app.ts')];
  assert.throws(
    () => validateManifest(manifest(files), 'manifest.json'),
    /duplicate files path/,
  );
});

test('manifest validation rejects unsafe and non-normalized paths', () => {
  const files = [file('../outside.txt')];
  assert.throws(
    () => validateManifest(manifest(files), 'manifest.json'),
    /unsafe files\[0\] path/,
  );
});

test('manifest validation verifies base file integrity metadata', () => {
  const files = [file('index.ts')];
  const baseFiles = [file('old.ts')];
  assert.throws(
    () =>
      validateManifest(
        manifest(files, {
          kind: 'patch',
          baseFiles,
          baseRootHash: `sha256:${'0'.repeat(64)}`,
        }),
        'manifest.json',
      ),
    /base root hash is invalid/,
  );
});

test('manifest validation rejects circular composition metadata', () => {
  const files = [file('website/index.ts')];
  assert.throws(
    () =>
      validateManifest(
        manifest(files, {
          composition: {
            root: '.',
            entry: 'website',
            projects: [
              {
                name: 'website',
                path: 'website',
                dependsOn: ['backend'],
              },
              {
                name: 'backend',
                path: 'backend',
                dependsOn: ['website'],
              },
            ],
          },
        }),
        'manifest.json',
      ),
    /circular project composition graph/,
  );
});
