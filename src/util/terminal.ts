import { stderr, stdout } from 'node:process';

type OutputStream = 'stdout' | 'stderr';

const ansi = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  white: '\u001b[38;5;255m',
  light: '\u001b[38;5;252m',
  gray: '\u001b[38;5;248m',
  muted: '\u001b[38;5;243m',
  warning: '\u001b[38;5;179m',
  error: '\u001b[38;5;203m',
} as const;

function colorsEnabled(stream: OutputStream): boolean {
  if ('NO_COLOR' in process.env || process.env.TERM === 'dumb') return false;
  return stream === 'stderr' ? Boolean(stderr.isTTY) : Boolean(stdout.isTTY);
}

function decorate(
  value: string,
  code: string,
  stream: OutputStream = 'stdout',
): string {
  if (!colorsEnabled(stream)) return value;
  return `${code}${value}${ansi.reset}`;
}

export const color = {
  bold: (value: string) => decorate(value, ansi.bold),
  dim: (value: string) => decorate(value, ansi.dim),
  white: (value: string) => decorate(value, ansi.white),
  light: (value: string) => decorate(value, ansi.light),
  gray: (value: string) => decorate(value, ansi.gray),
  muted: (value: string) => decorate(value, ansi.muted),
  red: (value: string) => decorate(value, ansi.error),
  green: (value: string) => decorate(value, ansi.white),
  yellow: (value: string) => decorate(value, ansi.warning),
  blue: (value: string) => decorate(value, ansi.light),
  magenta: (value: string) => decorate(value, ansi.gray),
  cyan: (value: string) => decorate(value, ansi.light),
  error: (value: string) => decorate(value, ansi.error, 'stderr'),
  warning: (value: string) => decorate(value, ansi.warning, 'stderr'),
};

export function label(name: string): string {
  return `${color.gray(name)}:`;
}

export function success(message: string): void {
  console.log(`${color.white('✓')} ${color.light(message)}`);
}

export function info(message: string): void {
  console.log(`${color.gray('›')} ${color.light(message)}`);
}

export function warning(message: string): void {
  console.warn(`${color.warning('Warning:')} ${message}`);
}

export function errorMessage(message: string): string {
  return `${color.error('package:')} ${message}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[index]}`;
}

export function colorChangeKind(kind: string, value = kind): string {
  if (kind === 'CONFLICT') return color.yellow(color.bold(value));
  if (kind === 'ADD') return color.white(color.bold(value));
  if (kind === 'MODIFY') return color.white(value);
  if (kind === 'REMOVE') return color.gray(value);
  if (kind === 'MOVE' || kind === 'COPY') return color.light(value);
  if (kind === 'MODE') return color.muted(value);
  return color.light(value);
}

function helpOption(line: string): string | undefined {
  const option = line.match(
    /^(\s{2})(-[^ ]+(?:,\s+--?[^ ]+)?|--?[^ ]+)(\s+)(.*)$/,
  );
  if (!option) return undefined;
  return (
    `${option[1]}${color.light(option[2] ?? '')}${option[3]}` +
    color.muted(option[4] ?? '')
  );
}

export function colorizeHelp(text: string): string {
  return text
    .split('\n')
    .map((line, index) => {
      if (line.length === 0) return line;
      if (index === 0) return color.white(color.bold(line));
      if (index === 1) return color.gray(line);
      if (/^[A-Z][A-Za-z ]+:$/.test(line)) return color.white(color.bold(line));
      const formattedOption = helpOption(line);
      if (formattedOption) return formattedOption;
      if (line.startsWith('  package ') || line.startsWith('  npx '))
        return color.light(line);
      if (
        line.startsWith('Backups are ') ||
        line.startsWith('Deleted/replaced ')
      )
        return color.gray(line);
      return color.muted(line);
    })
    .join('\n');
}
