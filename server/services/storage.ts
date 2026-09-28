import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig } from '../config.js';

export interface StoredObject { key: string; sizeBytes: number; contentType: string; }
export interface ObjectStorage { put(localPath: string, key: string, contentType: string): Promise<StoredObject>; open(key: string): NodeJS.ReadableStream; }

export class LocalObjectStorage implements ObjectStorage {
  constructor(private readonly config: AppConfig) {}
  private resolve(key: string) {
    const root = path.resolve(this.config.STORAGE_DIR);
    const resolved = path.resolve(root, key);
    if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Invalid storage key');
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
}
