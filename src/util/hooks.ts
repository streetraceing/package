import { spawn } from 'node:child_process';
import { PackageError } from '../errors.js';
import { color, label, symbol, warning } from './terminal.js';

export type PackageHookName =
  'beforePackage' | 'afterPackage' | 'beforeApply' | 'afterApply';
export type PackageCommandName = 'zip' | 'shift' | 'apply';
export type HookFailureMode = 'throw' | 'warn';

export interface PackageHookContext {
  root: string;
  archivePath: string;
  command: PackageCommandName;
  packageManager?: string;
  quiet?: boolean;
}

export interface PackageHookFailure {
  script: string;
  error: PackageError;
}

export interface RunPackageHooksOptions {
  failureMode?: HookFailureMode;
}

function packageHookError(
  hook: PackageHookName,
  script: string,
  detail: string,
): PackageError {
  return new PackageError(
    `${hook} script failed (${detail}): ${script}`,
    'PACKAGE_HOOK_FAILED',
  );
}

function runHookScript(
  script: string,
  hook: PackageHookName,
  context: PackageHookContext,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const packageManager = context.packageManager ?? 'npm';
    const resolvedScript = script.replaceAll(
      '{packageManager}',
      packageManager,
    );
    const child = spawn(resolvedScript, {
      cwd: context.root,
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        PACKAGE_HOOK: hook,
        PACKAGE_COMMAND: context.command,
        PACKAGE_ROOT: context.root,
        PACKAGE_ARCHIVE: context.archivePath,
        PACKAGE_MANAGER: packageManager,
      },
    });

    child.once('error', (error) => {
      reject(
        packageHookError(
          hook,
          resolvedScript,
          `cannot start: ${error.message}`,
        ),
      );
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = signal
        ? `signal ${signal}`
        : `exit code ${code ?? 'unknown'}`;
      reject(packageHookError(hook, resolvedScript, detail));
    });
  });
}

function normalizeHookError(error: unknown): PackageError {
  if (error instanceof PackageError) return error;
  return new PackageError(
    error instanceof Error ? error.message : String(error),
    'PACKAGE_HOOK_FAILED',
  );
}

export async function runPackageHooks(
  hook: PackageHookName,
  scripts: readonly string[],
  context: PackageHookContext,
  options: RunPackageHooksOptions = {},
): Promise<PackageHookFailure[]> {
  const failureMode = options.failureMode ?? 'throw';
  const failures: PackageHookFailure[] = [];

  for (const script of scripts) {
    const packageManager = context.packageManager ?? 'npm';
    const resolvedScript = script.replaceAll(
      '{packageManager}',
      packageManager,
    );
    if (!context.quiet)
      console.log(
        `${color.muted(symbol.branch)} ${color.magenta(symbol.hook)} ${label(hook)} ${color.bold(resolvedScript)} ${color.muted(`${symbol.arrow} ${context.command}`)}`,
      );
    try {
      await runHookScript(script, hook, context);
    } catch (error) {
      const normalized = normalizeHookError(error);
      if (failureMode === 'throw') throw normalized;
      failures.push({ script, error: normalized });
      warning(normalized.message);
    }
  }

  return failures;
}
