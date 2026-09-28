import { Readable } from 'node:stream';
import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AppConfig } from '../config.js';
import { AppError } from '../errors.js';

export interface StoredObject { key: string; sizeBytes: number; contentType: string; }
export interface ObjectStorage {
  put(localPath: string, key: string, contentType: string): Promise<StoredObject>;
  open(key: string): Readable;
  delete(key: string): Promise<void>;
  createSignedUrl?(key: string, expiresInSeconds?: number): Promise<string>;
}

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly config: AppConfig) {}
  private resolve(key: string) {
    const root = path.resolve(this.config.STORAGE_DIR);
    const resolved = path.resolve(root, key);
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new AppError('INVALID_STORAGE_KEY', 'Invalid storage key.', 400);
    return resolved;
  }
  async put(localPath: string, key: string, contentType: string) {
    const destination = this.resolve(key);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(localPath, destination);
    const stat = await fs.stat(destination);
    return { key, sizeBytes: stat.size, contentType };
  }
  open(key: string) { return createReadStream(this.resolve(key)); }
  async delete(key: string) { await fs.rm(this.resolve(key), { force: true }); }
}

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  constructor(private readonly config: AppConfig) {
    if (!config.STORAGE_ENDPOINT || !config.STORAGE_BUCKET || !config.STORAGE_ACCESS_KEY || !config.STORAGE_SECRET_KEY) throw new Error('S3 storage configuration is incomplete');
    this.client = new S3Client({ endpoint: config.STORAGE_ENDPOINT, region: config.STORAGE_REGION, forcePathStyle: true, credentials: { accessKeyId: config.STORAGE_ACCESS_KEY!, secretAccessKey: config.STORAGE_SECRET_KEY! } });
  }
  async put(localPath: string, key: string, contentType: string) {
    const body = await fs.readFile(localPath);
    await this.client.send(new PutObjectCommand({ Bucket: this.config.STORAGE_BUCKET!, Key: key, Body: body, ContentType: contentType }));
    return { key, sizeBytes: body.byteLength, contentType };
  }
  open(key: string) {
    const stream = new Readable({ read() { this.push(null); } });
    void this.client.send(new GetObjectCommand({ Bucket: this.config.STORAGE_BUCKET!, Key: key })).then((response) => {
      const body = response.Body as AsyncIterable<Uint8Array> | undefined;
      if (!body) return stream.destroy(new Error('Storage returned an empty object'));
      void (async () => { try { for await (const chunk of body) stream.push(chunk); stream.push(null); } catch (error) { stream.destroy(error as Error); } })();
    }).catch((error) => stream.destroy(error as Error));
    return stream;
  }
  async delete(key: string) { await this.client.send(new DeleteObjectCommand({ Bucket: this.config.STORAGE_BUCKET!, Key: key })); }
  async createSignedUrl(key: string, expiresInSeconds = 300) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.STORAGE_BUCKET!, Key: key }), { expiresIn: expiresInSeconds });
  }
}

export function createObjectStorage(config: AppConfig): ObjectStorage {
  return config.STORAGE_DRIVER === 's3' ? new S3ObjectStorage(config) : new LocalObjectStorage(config);
}
