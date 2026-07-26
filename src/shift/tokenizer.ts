import { ShiftSyntaxError } from '../errors.js';

export type ShiftTokenType = 'WORD' | 'STRING';

export interface ShiftToken {
  type: ShiftTokenType;
  value: string;
  line: number;
  column: number;
  sourceLine: string;
}

function decodeEscape(char: string): string {
  if (char === 'n') return '\n';
  if (char === 'r') return '\r';
  if (char === 't') return '\t';
  if (char === '"') return '"';
  if (char === '\\') return '\\';
  return char;
}

export function tokenizeShift(source: string, sourceName = '.packageshift'): ShiftToken[][] {
  const output: ShiftToken[][] = [];
  const lines = source.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const sourceLine = lines[lineIndex] ?? '';
    const tokens: ShiftToken[] = [];
    let index = 0;
    while (index < sourceLine.length) {
      const char = sourceLine[index] ?? '';
      if (/\s/.test(char)) {
        index += 1;
        continue;
      }
      if (char === '#') break;
      const column = index + 1;
      if (char === '"') {
        index += 1;
        let value = '';
        let closed = false;
        while (index < sourceLine.length) {
          const current = sourceLine[index] ?? '';
          if (current === '"') {
            closed = true;
            index += 1;
            break;
          }
          if (current === '\\') {
            index += 1;
            if (index >= sourceLine.length) break;
            value += decodeEscape(sourceLine[index] ?? '');
            index += 1;
            continue;
          }
          value += current;
          index += 1;
        }
        if (!closed) {
          throw new ShiftSyntaxError(sourceName, lineIndex + 1, column, sourceLine, 'Unterminated quoted string.', 'Close the string with a double quote.', 'PS1002');
        }
        tokens.push({ type: 'STRING', value, line: lineIndex + 1, column, sourceLine });
        continue;
      }
      let value = '';
      while (index < sourceLine.length && !/\s/.test(sourceLine[index] ?? '') && sourceLine[index] !== '#') {
        value += sourceLine[index] ?? '';
        index += 1;
      }
      tokens.push({ type: 'WORD', value, line: lineIndex + 1, column, sourceLine });
    }
    if (tokens.length > 0) output.push(tokens);
  }
  return output;
}
