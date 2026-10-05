import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';

export interface StoredObject { key: string; sizeBytes: number; contentType: string; }
export interface ByteRange { start: number; end: number; }

export interface ObjectStorage {
  put(localPath: string, key: string, contentType: string): Promise<StoredObject>;
  /** Downloads an object to a local file (used by workers to avoid re-downloading from YouTube). */
  download(key: string, localPath: string): Promise<void>;
  size(key: string): Promise<number | null>;
  open(key: string, range?: ByteRange): Promise<Readable>;
  delete(key: string): Promise<void>;
  deletePrefix(prefix: string): Promise<void>;
  /** Returns a direct signed URL when the backend supports it (S3/R2/GCS); null for local disk. */
  signedUrl(key: string, expiresInSeconds: number, downloadName?: string): Promise<string | null>;
}

function assertSafeKey(key: string) {
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\')) throw new AppError('INVALID_STORAGE_KEY', 'Invalid storage key.', 400);
}

export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;
  constructor(config: Pick<AppConfig, 'STORAGE_DIR'>) {
    this.root = path.resolve(config.STORAGE_DIR);
  }

  private resolve(key: string) {
    assertSafeKey(key);
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) throw new AppError('INVALID_STORAGE_KEY', 'Invalid storage key.', 400);
    return resolved;
  }

  async put(localPath: string, key: string, contentType: string) {
    const destination = this.resolve(key);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(localPath, destination);
    const stat = await fs.stat(destination);
    return { key, sizeBytes: stat.size, contentType };
  }

  async download(key: string, localPath: string) {
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.copyFile(this.resolve(key), localPath);
  }

  async size(key: string) {
    try {
      return (await fs.stat(this.resolve(key))).size;
    } catch {
      return null;
    }
  }

  async open(key: string, range?: ByteRange) {
    return createReadStream(this.resolve(key), range ? { start: range.start, end: range.end } : undefined);
  }

  async delete(key: string) {
    await fs.rm(this.resolve(key), { force: true });
  }

  async deletePrefix(prefix: string) {
    await fs.rm(this.resolve(prefix.replace(/\/$/, '')), { recursive: true, force: true });
  }

  async signedUrl() {
    return null;
  }
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    if (!config.STORAGE_ENDPOINT || !config.STORAGE_BUCKET || !config.STORAGE_ACCESS_KEY || !config.STORAGE_SECRET_KEY) {
      throw new Error('S3 storage configuration is incomplete');
    }
    this.bucket = config.STORAGE_BUCKET;
    this.client = new S3Client({
      endpoint: config.STORAGE_ENDPOINT,
      region: config.STORAGE_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: config.STORAGE_ACCESS_KEY, secretAccessKey: config.STORAGE_SECRET_KEY },
    });
  }

  async put(localPath: string, key: string, contentType: string) {
    assertSafeKey(key);
    const stat = await fs.stat(localPath);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: createReadStream(localPath), ContentLength: stat.size, ContentType: contentType }));
    return { key, sizeBytes: stat.size, contentType };
  }

  async download(key: string, localPath: string) {
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await pipeline(await this.open(key), createWriteStream(localPath));
  }

  async size(key: string) {
    try {
      const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return head.ContentLength ?? null;
    } catch {
      return null;
    }
  }

  async open(key: string, range?: ByteRange) {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined }));
    if (!response.Body) throw new AppError('STORAGE_EMPTY', 'Stored file is unavailable.', 404);
    return response.Body as Readable;
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async deletePrefix(prefix: string) {
    let token: string | undefined;
    do {
      const list = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const objects = (list.Contents ?? []).flatMap((item) => (item.Key ? [{ Key: item.Key }] : []));
      if (objects.length > 0) await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: objects } }));
      token = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (token);
  }

  async signedUrl(key: string, expiresInSeconds: number, downloadName?: string) {
    return getSignedUrl(this.client, new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: downloadName ? `attachment; filename="${downloadName}"` : undefined,
    }), { expiresIn: Math.min(expiresInSeconds, 7 * 24 * 3600) });
  }
}

export function createObjectStorage(config: AppConfig): ObjectStorage {
  return config.STORAGE_DRIVER === 's3' ? new S3ObjectStorage(config) : new LocalObjectStorage(config);
}

/** Parses a single-range HTTP Range header ("bytes=start-end"). Returns null when absent/invalid. */
export function parseRangeHeader(header: string | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startText, endText] = match;
  if (startText === '' && endText === '') return null;
  let start: number;
  let end: number;
  if (startText === '') {
    const suffix = Number(endText);
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  }
  if (start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

export { Readable };
