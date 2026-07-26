export class PackageError extends Error {
  constructor(
    message: string,
    readonly code = 'PACKAGE_ERROR',
  ) {
    super(message);
    this.name = 'PackageError';
  }
}

export class ShiftSyntaxError extends PackageError {
  constructor(
    readonly sourceName: string,
    readonly line: number,
    readonly column: number,
    readonly sourceLine: string,
    message: string,
    readonly hint?: string,
    code = 'PS1000',
  ) {
    const caret = `${' '.repeat(Math.max(0, column - 1))}^`;
    super(
      `${sourceName}:${line}:${column} ${code}\n\n${sourceLine}\n${caret}\n\n${message}${hint ? `\n\n${hint}` : ''}`,
      code,
    );
    this.name = 'ShiftSyntaxError';
  }
}
