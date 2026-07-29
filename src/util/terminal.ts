import { stderr, stdout } from 'node:process';

type OutputStream = 'stdout' | 'stderr';

const ansi = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
} as const;

function colorsEnabled(stream: OutputStream): boolean {
  if ('NO_COLOR' in process.env || process.env.TERM === 'dumb') return false;
  return stream === 'stderr' ? Boolean(stderr.isTTY) : Boolean(stdout.isTTY);
}

function decorate(
  value: string,
  code: keyof typeof ansi,
  stream: OutputStream = 'stdout',
): string {
  if (!colorsEnabled(stream)) return value;
  return `${ansi[code]}${value}${ansi.reset}`;
}

export const color = {
  bold: (value: string) => decorate(value, 'bold'),
  dim: (value: string) => decorate(value, 'dim'),
  red: (value: string) => decorate(value, 'red'),
  green: (value: string) => decorate(value, 'green'),
  yellow: (value: string) => decorate(value, 'yellow'),
  blue: (value: string) => decorate(value, 'blue'),
  magenta: (value: string) => decorate(value, 'magenta'),
  cyan: (value: string) => decorate(value, 'cyan'),
  error: (value: string) => decorate(value, 'red', 'stderr'),
  warning: (value: string) => decorate(value, 'yellow', 'stderr'),
};

export function label(name: string): string {
  return `${color.cyan(name)}:`;
}

export function success(message: string): void {
  console.log(`${color.green('✓')} ${message}`);
}

export function info(message: string): void {
  console.log(`${color.cyan('›')} ${message}`);
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
  if (kind === 'ADD') return color.green(value);
  if (kind === 'MODIFY') return color.yellow(value);
  if (kind === 'REMOVE' || kind === 'CONFLICT') return color.red(value);
  if (kind === 'MOVE' || kind === 'COPY') return color.blue(value);
  if (kind === 'MODE') return color.magenta(value);
  return value;
}

export function colorizeHelp(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (/^[A-Z][A-Za-z ]+:$/.test(line)) return color.bold(color.cyan(line));
      if (line.startsWith('  package ') || line.startsWith('  npx '))
        return color.green(line);
      const option = line.match(
        /^(\s{2})(-[^ ]+(?:,\s+--?[^ ]+)?|--?[^ ]+)(.*)$/,
      );
      if (option)
        return `${option[1]}${color.cyan(option[2] ?? '')}${option[3] ?? ''}`;
      return line;
    })
    .join('\n');
}
