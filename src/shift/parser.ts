import { ShiftSyntaxError } from '../errors.js';
import type { ParsedShift, ShiftInstruction } from '../types.js';
import { normalizeRelativePath } from '../util/path.js';
import { tokenizeShift, type ShiftToken } from './tokenizer.js';

function fail(
  token: ShiftToken,
  sourceName: string,
  message: string,
  hint?: string,
  code = 'PS1003',
): never {
  throw new ShiftSyntaxError(
    sourceName,
    token.line,
    token.column,
    token.sourceLine,
    message,
    hint,
    code,
  );
}

function requireCount(
  tokens: ShiftToken[],
  expected: number | number[],
  sourceName: string,
  syntax: string,
): void {
  const counts = Array.isArray(expected) ? expected : [expected];
  if (!counts.includes(tokens.length)) {
    const token = tokens[Math.min(tokens.length - 1, 0)] ?? {
      line: 1,
      column: 1,
      sourceLine: '',
      type: 'WORD' as const,
      value: '',
    };
    fail(token, sourceName, `Invalid instruction.`, `Expected: ${syntax}`);
  }
}

function stringToken(
  token: ShiftToken | undefined,
  sourceName: string,
  label: string,
): string {
  if (!token) throw new Error('Parser invariant failed.');
  if (token.type !== 'STRING')
    fail(
      token,
      sourceName,
      `${label} must be a quoted string.`,
      `Use double quotes, for example: "src/index.ts"`,
    );
  try {
    return normalizeRelativePath(token.value);
  } catch (error) {
    fail(
      token,
      sourceName,
      (error as Error).message,
      'Paths must be relative to the project root and use forward slashes.',
      'PS1005',
    );
  }
}

function hashToken(token: ShiftToken | undefined, sourceName: string): string {
  if (!token) throw new Error('Parser invariant failed.');
  if (!/^sha256:[a-fA-F0-9]{64}$/.test(token.value)) {
    fail(
      token,
      sourceName,
      'Expected a complete SHA-256 value.',
      'Use sha256 followed by exactly 64 hexadecimal characters.',
      'PS1006',
    );
  }
  return token.value.toLowerCase();
}

function optionalHash(
  tokens: ShiftToken[],
  start: number,
  sourceName: string,
): string | undefined {
  if (tokens.length === start) return undefined;
  if (
    tokens.length !== start + 2 ||
    tokens[start]?.value.toUpperCase() !== 'IF'
  ) {
    const token = tokens[start] ?? tokens[0];
    if (!token) throw new Error('Parser invariant failed.');
    fail(
      token,
      sourceName,
      'Invalid hash condition.',
      'Expected: IF sha256:<64 hexadecimal characters>',
    );
  }
  return hashToken(tokens[start + 1], sourceName);
}

export function parseShift(
  source: string,
  sourceName = '.packageshift',
): ParsedShift {
  const lines = tokenizeShift(source, sourceName);
  if (lines.length === 0) {
    throw new ShiftSyntaxError(
      sourceName,
      1,
      1,
      '',
      'The shift file is empty.',
      'The first instruction must be: PACKAGESHIFT 1',
      'PS1000',
    );
  }
  const header = lines[0] ?? [];
  requireCount(header, 2, sourceName, 'PACKAGESHIFT 1');
  if (header[0]?.value.toUpperCase() !== 'PACKAGESHIFT') {
    fail(
      header[0] as ShiftToken,
      sourceName,
      'The first instruction must declare the format version.',
      'Use: PACKAGESHIFT 1',
      'PS1000',
    );
  }
  if (header[1]?.value !== '1')
    fail(
      header[1] as ShiftToken,
      sourceName,
      'Unsupported PackageShift version.',
      'This release supports: PACKAGESHIFT 1',
      'PS1007',
    );

  const instructions: ShiftInstruction[] = [];
  for (const tokens of lines.slice(1)) {
    const commandToken = tokens[0] as ShiftToken;
    const command = commandToken.value.toUpperCase();
    if (command === 'MESSAGE') {
      requireCount(tokens, 2, sourceName, 'MESSAGE "description"');
      const value = tokens[1];
      if (value?.type !== 'STRING')
        fail(
          value as ShiftToken,
          sourceName,
          'MESSAGE requires a quoted string.',
          'Expected: MESSAGE "description"',
        );
      instructions.push({
        type: 'MESSAGE',
        value: value.value,
        line: commandToken.line,
      });
    } else if (command === 'BASE') {
      requireCount(tokens, 2, sourceName, 'BASE sha256:<hash>');
      instructions.push({
        type: 'BASE',
        hash: hashToken(tokens[1], sourceName),
        line: commandToken.line,
      });
    } else if (command === 'REMOVE') {
      if (tokens.length !== 2 && tokens.length !== 4)
        requireCount(
          tokens,
          [2, 4],
          sourceName,
          'REMOVE "path" [IF sha256:<hash>]',
        );
      instructions.push({
        type: 'REMOVE',
        path: stringToken(tokens[1], sourceName, 'REMOVE path'),
        expectedHash: optionalHash(tokens, 2, sourceName),
        line: commandToken.line,
      });
    } else if (command === 'MOVE') {
      if (tokens.length !== 4 && tokens.length !== 6)
        requireCount(
          tokens,
          [4, 6],
          sourceName,
          'MOVE "source" TO "destination" [IF sha256:<hash>]',
        );
      if (tokens[2]?.value.toUpperCase() !== 'TO')
        fail(
          tokens[2] as ShiftToken,
          sourceName,
          'Expected TO between source and destination.',
          'Correct form: MOVE "src/old.ts" TO "src/new.ts"',
          'PS1004',
        );
      instructions.push({
        type: 'MOVE',
        from: stringToken(tokens[1], sourceName, 'MOVE source'),
        to: stringToken(tokens[3], sourceName, 'MOVE destination'),
        expectedHash: optionalHash(tokens, 4, sourceName),
        line: commandToken.line,
      });
    } else if (command === 'COPY') {
      requireCount(tokens, 4, sourceName, 'COPY "source" TO "destination"');
      if (tokens[2]?.value.toUpperCase() !== 'TO')
        fail(
          tokens[2] as ShiftToken,
          sourceName,
          'Expected TO between source and destination.',
          'Correct form: COPY "src/a.ts" TO "src/b.ts"',
          'PS1004',
        );
      instructions.push({
        type: 'COPY',
        from: stringToken(tokens[1], sourceName, 'COPY source'),
        to: stringToken(tokens[3], sourceName, 'COPY destination'),
        line: commandToken.line,
      });
    } else if (command === 'REPLACE') {
      if (tokens.length !== 2 && tokens.length !== 4)
        requireCount(
          tokens,
          [2, 4],
          sourceName,
          'REPLACE "path" [IF sha256:<hash>]',
        );
      instructions.push({
        type: 'REPLACE',
        path: stringToken(tokens[1], sourceName, 'REPLACE path'),
        expectedHash: optionalHash(tokens, 2, sourceName),
        line: commandToken.line,
      });
    } else if (command === 'CHMOD') {
      requireCount(tokens, 3, sourceName, 'CHMOD "path" 755');
      const rawMode = tokens[2] as ShiftToken;
      if (!/^[0-7]{3,4}$/.test(rawMode.value))
        fail(
          rawMode,
          sourceName,
          'Invalid Unix permission mode.',
          'Use an octal mode such as 644 or 755.',
          'PS1008',
        );
      instructions.push({
        type: 'CHMOD',
        path: stringToken(tokens[1], sourceName, 'CHMOD path'),
        mode: Number.parseInt(rawMode.value, 8) & 0o777,
        line: commandToken.line,
      });
    } else {
      const hint =
        command === 'ALTER'
          ? 'Did you mean MOVE?'
          : 'Supported instructions: MESSAGE, BASE, REMOVE, MOVE, COPY, REPLACE, CHMOD.';
      fail(
        commandToken,
        sourceName,
        `Unknown instruction "${commandToken.value}".`,
        hint,
        'PS1001',
      );
    }
  }
  return { version: 1, instructions };
}
