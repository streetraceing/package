import test from 'node:test';
import assert from 'node:assert/strict';
import { formatChanges } from '../src/commands/diff.js';
import { statusLine, symbol } from '../src/util/terminal.js';

test('terminal status lines keep neutral tree connectors and semantic glyphs', () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    assert.equal(
      statusLine('success', 'Created archive.zip'),
      '├─ ◆ Created archive.zip',
    );
    assert.equal(
      statusLine('warning', 'Sensitive file'),
      '├─ ▲ Sensitive file',
    );
    assert.equal(symbol.lastBranch, '├─');
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});

test('change summaries remain branches until the divider terminates the tree', () => {
  const previous = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  try {
    const output = formatChanges([{ kind: 'ADD', path: 'src/index.ts' }]);
    assert.equal(
      output,
      '├─ + ADD      src/index.ts\n├─ 1 change │ 1 add\n└─────────────────────────────────────────',
    );
  } finally {
    if (previous === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = previous;
  }
});
