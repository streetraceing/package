import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { configSchemaUrl, defaultConfig, loadConfig } from '../src/config.js';
import { initCommand } from '../src/commands/meta.js';

interface JsonSchemaProperty {
  default?: unknown;
}

interface JsonSchema {
  $id?: string;
  properties?: Record<string, JsonSchemaProperty>;
}

test('package init creates a schema-enabled .packagerc', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'package-init-'));
  try {
    await initCommand(workspace, false);
    const generated = await readFile(
      path.join(workspace, '.packagerc'),
      'utf8',
    );
    assert.match(
      generated,
      new RegExp(
        `^\\{\\n  "\\$schema": "${configSchemaUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`,
      ),
    );

    const loaded = await loadConfig(workspace);
    assert.equal(loaded.config.$schema, configSchemaUrl);
    assert.equal(loaded.config.gitignore, true);
    assert.equal(loaded.config.type, 'zip');
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test('published JSON Schema matches configuration defaults', async () => {
  const schema = JSON.parse(
    await readFile(path.resolve('schema.json'), 'utf8'),
  ) as JsonSchema;
  assert.equal(schema.$id, configSchemaUrl);

  const properties = schema.properties ?? {};
  for (const [key, value] of Object.entries(defaultConfig)) {
    assert.deepEqual(
      properties[key]?.default,
      value,
      `schema default for ${key}`,
    );
  }
  assert.equal(properties.$schema?.default, configSchemaUrl);
});

test('configuration rejects options not declared by the schema', async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), 'package-config-'));
  try {
    await writeFile(
      path.join(workspace, '.packagerc'),
      '{ unknownOption: true }\n',
      'utf8',
    );
    await assert.rejects(
      loadConfig(workspace),
      /unknown option "unknownOption"/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
