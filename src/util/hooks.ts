import { spawn } from 'node:child_process';
import { PackageError } from '../errors.js';

export type PackageHookName = 'beforePackage' | 'afterPackage';
export type PackageCommandName = 'zip' | 'shift';

export interface PackageHookContext {
  root: string;
  archivePath: string;
  command: PackageCommandName;
  quiet?: boolean;
}

function runShellCommand(
  script: string,
  hook: PackageHookName,
  context: PackageHookContext,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(script, {
      cwd: context.root,
      shell: true,
      stdio: 'inherit',
      env: {
        ...process.env,
        PACKAGE_HOOK: hook,
        PACKAGE_COMMAND: context.command,
        PACKAGE_ROOT: context.root,
        PACKAGE_ARCHIVE: context.archivePath,
      },
    });

    child.once('error', (error) => {
      reject(
        new PackageError(
          `Cannot start ${hook} script ${JSON.stringify(script)}: ${error.message}`,
          'PACKAGE_HOOK_FAILED',
        ),
      );
    });
    child.once('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const status = signal
        ? `signal ${signal}`
        : `exit code ${code ?? 'unknown'}`;
      const retained =
        hook === 'afterPackage'
          ? ` The created archive was retained at ${context.archivePath}.`
          : '';
      reject(
        new PackageError(
          `${hook} script failed with ${status}: ${script}.${retained}`,
          'PACKAGE_HOOK_FAILED',
        ),
      );
    });
  });
}

export async function runPackageHooks(
  hook: PackageHookName,
  scripts: readonly string[],
  context: PackageHookContext,
): Promise<void> {
  for (const script of scripts) {
    if (!context.quiet) console.log(`${hook}: ${script}`);
    await runShellCommand(script, hook, context);
  }
}
