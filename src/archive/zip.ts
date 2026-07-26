import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { readFile, writeFile } from 'node:fs/promises';
import { crc32 } from '../util/crc32.js';
import { normalizeRelativePath } from '../util/path.js';
import { PackageError } from '../errors.js';
import type { ArchiveEntry, ReadArchiveEntry } from '../types.js';

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const UTF8_FLAG = 0x0800;
const MAX_ENTRY_SIZE = 1024 * 1024 * 1024;

function dateToDos(date: Date): { time: number; date: number } {
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  return {
    time: ((date.getUTCHours() & 0x1f) << 11) | ((date.getUTCMinutes() & 0x3f) << 5) | ((Math.floor(date.getUTCSeconds() / 2)) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9) | (((date.getUTCMonth() + 1) & 0x0f) << 5) | (date.getUTCDate() & 0x1f),
  };
}

function dosToDate(time: number, date: number): Date {
  const year = 1980 + ((date >>> 9) & 0x7f);
  const month = ((date >>> 5) & 0x0f) - 1;
  const day = date & 0x1f;
  const hour = (time >>> 11) & 0x1f;
  const minute = (time >>> 5) & 0x3f;
  const second = (time & 0x1f) * 2;
  return new Date(Date.UTC(year, Math.max(0, month), Math.max(1, day), hour, minute, second));
}

export interface WriteZipOptions {
  compressionLevel?: number;
  deterministic?: boolean;
}

export async function writeZip(filePath: string, entries: ArchiveEntry[], options: WriteZipOptions = {}): Promise<void> {
  const sorted = [...entries].sort((left, right) => left.path.localeCompare(right.path));
  if (sorted.length > 0xffff) throw new PackageError('ZIP64 is not supported: too many entries.', 'ZIP64_UNSUPPORTED');
  const chunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const entry of sorted) {
    const safePath = normalizeRelativePath(entry.path);
    const name = Buffer.from(safePath, 'utf8');
    const raw = Buffer.from(entry.data);
    if (raw.length > 0xffffffff) throw new PackageError(`ZIP64 is not supported for ${safePath}.`, 'ZIP64_UNSUPPORTED');
    const requestedMethod = entry.compression === 'store' || options.compressionLevel === 0 ? 0 : 8;
    const deflated = requestedMethod === 8 ? deflateRawSync(raw, { level: options.compressionLevel ?? 9 }) : raw;
    const method = requestedMethod === 8 && deflated.length < raw.length ? 8 : 0;
    const compressed = method === 8 ? deflated : raw;
    const checksum = crc32(raw);
    const timestamp = options.deterministic ? new Date(Date.UTC(1980, 0, 1, 0, 0, 0)) : (entry.mtime ?? new Date());
    const dos = dateToDos(timestamp);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dos.time, 10);
    local.writeUInt16LE(dos.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_FILE_HEADER, 0);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dos.time, 12);
    central.writeUInt16LE(dos.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    const unixMode = (entry.mode ?? 0o644) | 0o100000;
    central.writeUInt32LE((unixMode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const centralSize = centralChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (centralOffset > 0xffffffff || centralSize > 0xffffffff) {
    throw new PackageError('ZIP64 is not supported for archives larger than 4 GiB.', 'ZIP64_UNSUPPORTED');
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  await writeFile(filePath, Buffer.concat([...chunks, ...centralChunks, end]));
}

function findEndRecord(data: Buffer): number {
  const minimum = Math.max(0, data.length - 0xffff - 22);
  for (let index = data.length - 22; index >= minimum; index -= 1) {
    if (data.readUInt32LE(index) === END_OF_CENTRAL_DIRECTORY) return index;
  }
  throw new PackageError('Invalid ZIP archive: end-of-central-directory record not found.', 'ZIP_INVALID');
}

export async function readZip(filePath: string): Promise<Map<string, ReadArchiveEntry>> {
  const data = await readFile(filePath);
  const endOffset = findEndRecord(data);
  const disk = data.readUInt16LE(endOffset + 4);
  const centralDisk = data.readUInt16LE(endOffset + 6);
  const entryCount = data.readUInt16LE(endOffset + 10);
  const centralSize = data.readUInt32LE(endOffset + 12);
  const centralOffset = data.readUInt32LE(endOffset + 16);
  if (disk !== 0 || centralDisk !== 0) throw new PackageError('Multi-disk ZIP archives are not supported.', 'ZIP_UNSUPPORTED');
  if (centralOffset + centralSize > data.length) throw new PackageError('Invalid ZIP central directory bounds.', 'ZIP_INVALID');
  const entries = new Map<string, ReadArchiveEntry>();
  let cursor = centralOffset;
  let expandedTotal = 0;

  for (let count = 0; count < entryCount; count += 1) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) {
      throw new PackageError('Invalid ZIP central directory entry.', 'ZIP_INVALID');
    }
    const flags = data.readUInt16LE(cursor + 8);
    const method = data.readUInt16LE(cursor + 10);
    const modifiedTime = data.readUInt16LE(cursor + 12);
    const modifiedDate = data.readUInt16LE(cursor + 14);
    const expectedCrc = data.readUInt32LE(cursor + 16);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const uncompressedSize = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const externalAttributes = data.readUInt32LE(cursor + 38);
    const localOffset = data.readUInt32LE(cursor + 42);
    if ((flags & 1) !== 0) throw new PackageError('Encrypted ZIP entries are not supported.', 'ZIP_UNSUPPORTED');
    if (method !== 0 && method !== 8) throw new PackageError(`Unsupported ZIP compression method: ${method}`, 'ZIP_UNSUPPORTED');
    if (uncompressedSize > MAX_ENTRY_SIZE) throw new PackageError('ZIP entry exceeds the 1 GiB safety limit.', 'ZIP_TOO_LARGE');
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > data.length) throw new PackageError('Invalid ZIP entry name bounds.', 'ZIP_INVALID');
    const rawName = data.subarray(nameStart, nameEnd).toString((flags & UTF8_FLAG) !== 0 ? 'utf8' : 'latin1');
    const isDirectory = rawName.endsWith('/');
    const safePath = isDirectory ? normalizeRelativePath(rawName.slice(0, -1)) : normalizeRelativePath(rawName);
    if (entries.has(safePath)) throw new PackageError(`Duplicate ZIP entry: ${safePath}`, 'ZIP_DUPLICATE');
    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new PackageError(`Invalid local ZIP header for ${safePath}.`, 'ZIP_INVALID');
    }
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const payloadStart = localOffset + 30 + localNameLength + localExtraLength;
    const payloadEnd = payloadStart + compressedSize;
    if (payloadEnd > data.length) throw new PackageError(`Invalid ZIP payload bounds for ${safePath}.`, 'ZIP_INVALID');
    const compressed = data.subarray(payloadStart, payloadEnd);
    const payload = method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed);
    if (payload.length !== uncompressedSize || crc32(payload) !== expectedCrc) {
      throw new PackageError(`ZIP integrity check failed for ${safePath}.`, 'ZIP_INTEGRITY');
    }
    expandedTotal += payload.length;
    if (expandedTotal > 4 * 1024 * 1024 * 1024) throw new PackageError('Expanded archive exceeds the 4 GiB safety limit.', 'ZIP_TOO_LARGE');
    const mode = ((externalAttributes >>> 16) & 0o777) || (isDirectory ? 0o755 : 0o644);
    entries.set(safePath, {
      path: safePath,
      data: payload,
      mode,
      mtime: dosToDate(modifiedTime, modifiedDate),
      isDirectory,
    });
    cursor = nameEnd + extraLength + commentLength;
  }
  return entries;
}
