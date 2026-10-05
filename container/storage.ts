import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/**
 * R2 access from inside the container. Requests to `http://r2.internal` are intercepted by the
 * Worker's outbound handler, which talks to the R2 binding — no S3 credentials live in the container.
 */
export const STORAGE_BASE = process.env.STORAGE_BASE_URL ?? 'http://r2.internal';
const SINGLE_PUT_LIMIT = 48 * 1024 * 1024;
const PART_SIZE = 32 * 1024 * 1024;

export function objectUrl(key: string): string {
  return `${STORAGE_BASE}/object?key=${encodeURIComponent(key)}`;
}

async function check(response: Response, action: string): Promise<Response> {
  if (!response.ok) throw new Error(`storage ${action} failed: HTTP ${response.status} ${await response.text().catch(() => '')}`);
  return response;
}

export async function downloadObject(key: string, localPath: string): Promise<void> {
  const response = await check(await fetch(objectUrl(key)), 'download');
  if (!response.body) throw new Error('storage download returned no body');
  await pipeline(Readable.fromWeb(response.body as unknown as WebReadableStream), createWriteStream(localPath));
}

async function readSlice(path: string, start: number, length: number): Promise<Buffer> {
  const handle = await fs.open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Uploads a local file, switching to multipart for large files so each request stays small. */
export async function uploadFile(localPath: string, key: string, contentType: string): Promise<number> {
  const { size } = await fs.stat(localPath);
  const q = `key=${encodeURIComponent(key)}`;
  if (size <= SINGLE_PUT_LIMIT) {
    const body = await fs.readFile(localPath);
    await check(await fetch(`${STORAGE_BASE}/object?${q}`, { method: 'PUT', headers: { 'content-type': contentType, 'content-length': String(size) }, body }), 'put');
    return size;
  }
  const created = (await (await check(await fetch(`${STORAGE_BASE}/mpu/create?${q}`, { method: 'POST', headers: { 'content-type': contentType } }), 'mpu create')).json()) as { uploadId: string };
  const uploadQ = `${q}&uploadId=${encodeURIComponent(created.uploadId)}`;
  try {
    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (let offset = 0, partNumber = 1; offset < size; offset += PART_SIZE, partNumber += 1) {
      const chunk = await readSlice(localPath, offset, Math.min(PART_SIZE, size - offset));
      const response = await check(await fetch(`${STORAGE_BASE}/mpu/part?${uploadQ}&part=${partNumber}`, { method: 'PUT', headers: { 'content-length': String(chunk.length) }, body: chunk }), 'mpu part');
      parts.push((await response.json()) as { partNumber: number; etag: string });
    }
    await check(await fetch(`${STORAGE_BASE}/mpu/complete?${uploadQ}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parts }) }), 'mpu complete');
    return size;
  } catch (error) {
    await fetch(`${STORAGE_BASE}/mpu/abort?${uploadQ}`, { method: 'POST' }).catch(() => undefined);
    throw error;
  }
}

export { createReadStream };
