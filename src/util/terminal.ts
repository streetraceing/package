import { stderr, stdout } from 'node:process';

type OutputStream = 'stdout' | 'stderr';

const ansi = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  white: '\u001b[38;5;255m',
  light: '\u001b[38;5;252m',
  gray: '\u001b[38;5;247m',
  muted: '\u001b[38;5;242m',
  cyan: '\u001b[38;5;81m',
  blue: '\u001b[38;5;75m',
  green: '\u001b[38;5;78m',
  yellow: '\u001b[38;5;221m',
  orange: '\u001b[38;5;215m',
  red: '\u001b[38;5;203m',
  magenta: '\u001b[38;5;177m',
} as const;

export const symbol = {
  success: '✓',
  info: '●',
  warning: '▲',
  error: '✖',
  section: '◆',
  branch: '├─',
  lastBranch: '└─',
  arrow: '→',
  add: '+',
  modify: '~',
  remove: '−',
  move: '↪',
  mode: '≋',
  conflict: '!',
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

function decorateMany(
  value: string,
  codes: readonly string[],
  stream: OutputStream = 'stdout',
): string {
  return decorate(value, codes.join(''), stream);
}

export const color = {
  bold: (value: string) => decorate(value, ansi.bold),
  dim: (value: string) => decorate(value, ansi.dim),
  white: (value: string) => decorate(value, ansi.white),
  light: (value: string) => decorate(value, ansi.light),
  gray: (value: string) => decorate(value, ansi.gray),
  muted: (value: string) => decorate(value, ansi.muted),
  red: (value: string) => decorate(value, ansi.red),
  green: (value: string) => decorate(value, ansi.green),
  yellow: (value: string) => decorate(value, ansi.yellow),
  orange: (value: string) => decorate(value, ansi.orange),
  blue: (value: string) => decorate(value, ansi.blue),
  magenta: (value: string) => decorate(value, ansi.magenta),
  cyan: (value: string) => decorate(value, ansi.cyan),
  accent: (value: string) => decorateMany(value, [ansi.bold, ansi.cyan]),
  positive: (value: string) => decorateMany(value, [ansi.bold, ansi.green]),
  caution: (value: string) => decorateMany(value, [ansi.bold, ansi.yellow]),
  danger: (value: string) => decorateMany(value, [ansi.bold, ansi.red]),
  error: (value: string) => decorate(value, ansi.red, 'stderr'),
  warning: (value: string) => decorate(value, ansi.yellow, 'stderr'),
  warningBold: (value: string) =>
    decorateMany(value, [ansi.bold, ansi.yellow], 'stderr'),
};

export function label(name: string): string {
  return `${color.cyan(name)}${color.muted(':')}`;
}

export function section(title: string): void {
  const left = color.muted('──');
  const right = color.muted('─'.repeat(Math.max(4, 30 - title.length)));
  console.log(`${left} ${color.accent(`${symbol.section} ${title}`)} ${right}`);
}

export function divider(width = 44): string {
  return color.muted('─'.repeat(width));
}

export function success(message: string): void {
  console.log(`${color.positive(symbol.success)} ${color.light(message)}`);
}

export function info(message: string): void {
  console.log(`${color.cyan(symbol.info)} ${color.light(message)}`);
}

export function warning(message: string): void {
  console.warn(
    `${color.warningBold(`${symbol.warning} Warning`)} ${color.muted('·')} ${message}`,
  );
}

export function errorMessage(message: string): string {
  return `${color.error(`${symbol.error} package`)}${color.error(':')} ${message}`;
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

export function changeSymbol(kind: string): string {
  if (kind === 'CONFLICT') return color.orange(symbol.conflict);
  if (kind === 'ADD') return color.green(symbol.add);
  if (kind === 'MODIFY') return color.cyan(symbol.modify);
  if (kind === 'REMOVE') return color.red(symbol.remove);
  if (kind === 'MOVE' || kind === 'COPY') return color.magenta(symbol.move);
  if (kind === 'MODE') return color.yellow(symbol.mode);
  return color.gray(symbol.info);
}

export function colorChangeKind(kind: string, value = kind): string {
  if (kind === 'CONFLICT') return color.orange(value);
  if (kind === 'ADD') return color.green(value);
  if (kind === 'MODIFY') return color.cyan(value);
  if (kind === 'REMOVE') return color.red(value);
  if (kind === 'MOVE' || kind === 'COPY') return color.magenta(value);
  if (kind === 'MODE') return color.yellow(value);
  if (kind === 'UNCHANGED') return color.muted(value);
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

/** Help intentionally stays monochrome so command output remains the visual focus. */
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
