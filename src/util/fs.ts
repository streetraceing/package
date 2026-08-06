import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';

function temporaryPath(target: string): string {
  const token = randomBytes(6).toString('hex');
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${token}.tmp`,
  );
}

async function replaceFile(source: string, target: string): Promise<void> {
  try {
    await rename(source, target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'ENOTEMPTY')
      throw error;
    await rm(target, { force: true });
    await rename(source, target);
  }
}

/** Write beside the destination and rename only after the temporary file has been written completely. */
export async function writeFileAtomic(
  target: string,
  data: string | NodeJS.ArrayBufferView,
  encoding?: BufferEncoding,
): Promise<void> {
  const resolved = path.resolve(target);
  await mkdir(path.dirname(resolved), { recursive: true });
  const temporary = temporaryPath(resolved);
  try {
    if (typeof data === 'string')
      await writeFile(temporary, data, encoding ?? 'utf8');
    else await writeFile(temporary, data);
    await replaceFile(temporary, resolved);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
