import test from 'node:test';
import assert from 'node:assert/strict';
import { parseShift } from '../src/shift/parser.js';
import { ShiftSyntaxError } from '../src/errors.js';

const hash = `sha256:${'a'.repeat(64)}`;

test('parses .packageshift instructions', () => {
  const parsed = parseShift(
    `PACKAGESHIFT 1\n\nMESSAGE "API update"\nBASE ${hash}\nREMOVE "src/unused.ts" IF ${hash}\nMOVE "src/old.ts" TO "src/new.ts" IF ${hash}\nCOPY "a.ts" TO "b.ts"\nREPLACE "src/index.ts"\nCHMOD "scripts/run.sh" 755\n`,
  );
  assert.equal(parsed.version, 1);
  assert.equal(parsed.instructions.length, 7);
  assert.deepEqual(parsed.instructions[2], {
    type: 'REMOVE',
    path: 'src/unused.ts',
    expectedHash: hash,
    line: 5,
  });
  assert.deepEqual(parsed.instructions[3], {
    type: 'MOVE',
    from: 'src/old.ts',
    to: 'src/new.ts',
    expectedHash: hash,
    line: 6,
  });
});

test('reports a useful ALTER error', () => {
  assert.throws(
    () => parseShift('PACKAGESHIFT 1\nALTER "old.ts" TO "new.ts"\n'),
    (error: unknown) => {
      assert.ok(error instanceof ShiftSyntaxError);
      assert.match(error.message, /Unknown instruction "ALTER"/);
      assert.match(error.message, /Did you mean MOVE/);
      assert.match(error.message, /:2:1 PS1001/);
      return true;
    },
  );
});

test('rejects paths outside the project', () => {
  assert.throws(
    () => parseShift('PACKAGESHIFT 1\nREMOVE "../outside.ts"\n'),
    /Path escapes the project root/,
  );
});
