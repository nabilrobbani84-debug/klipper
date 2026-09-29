import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { StorageFileRecord } from '../src/types';

const STORAGE_ROOT = path.join(process.cwd(), 'storage');
const SECRET_SIGNING_KEY = process.env.STORAGE_SIGNING_KEY || 'clipforge-secure-storage-key-2026';

// Categories with retention policies (in days)
const RETENTION_POLICIES: Record<StorageFileRecord['category'], number> = {
  original: 1,    // 24 hours
  clips: 7,       // 7 days
  projects: 30,   // 30 days
  exports: 14,    // 14 days
  thumbnails: 30, // 30 days
};

export class ObjectStorageEngine {
  private static instance: ObjectStorageEngine;
  private fileIndex: Map<string, StorageFileRecord> = new Map();

  private constructor() {
    this.initDirectories();
  }

  public static getInstance(): ObjectStorageEngine {
    if (!ObjectStorageEngine.instance) {
      ObjectStorageEngine.instance = new ObjectStorageEngine();
    }
    return ObjectStorageEngine.instance;
  }

  private initDirectories() {
    const categories: StorageFileRecord['category'][] = [
      'original',
      'projects',
      'clips',
      'exports',
      'thumbnails',
    ];

    for (const cat of categories) {
      const dir = path.join(STORAGE_ROOT, cat);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  public async saveFile(
    category: StorageFileRecord['category'],
    filename: string,
    data: Buffer | string,
    mimeType: string = 'video/mp4'
  ): Promise<StorageFileRecord> {
    const fileId = `file_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const safeFilename = `${fileId}_${path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const relativePath = path.join(category, safeFilename);
    const absolutePath = path.join(STORAGE_ROOT, relativePath);

    await fs.promises.writeFile(absolutePath, data);

    const stats = await fs.promises.stat(absolutePath);
    const retentionDays = RETENTION_POLICIES[category];
    const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString();

    const signedUrl = this.generateSignedUrl(relativePath, expiresAt);

    const record: StorageFileRecord = {
      id: fileId,
      category,
      path: relativePath,
      sizeBytes: stats.size,
      mimeType,
      createdAt: new Date().toISOString(),
      expiresAt,
      signedUrl,
      retentionDays,
    };

    this.fileIndex.set(fileId, record);
    return record;
  }

  public generateSignedUrl(relativePath: string, expiresAt: string): string {
    const hmac = crypto.createHmac('sha256', SECRET_SIGNING_KEY);
    hmac.update(`${relativePath}:${expiresAt}`);
    const token = hmac.digest('hex').substring(0, 32);
    return `/api/storage/download?path=${encodeURIComponent(relativePath)}&expires=${encodeURIComponent(expiresAt)}&token=${token}`;
  }

  public verifySignedUrl(relativePath: string, expiresAt: string, token: string): boolean {
    if (new Date(expiresAt).getTime() < Date.now()) {
      return false; // Expired
    }
    const hmac = crypto.createHmac('sha256', SECRET_SIGNING_KEY);
    hmac.update(`${relativePath}:${expiresAt}`);
    const expected = hmac.digest('hex').substring(0, 32);
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  }

  public getFilePath(relativePath: string): string {
    return path.join(STORAGE_ROOT, relativePath);
  }

  public getStorageMetrics() {
    let totalBytes = 0;
    const categoryBytes: Record<string, number> = {};

    for (const record of this.fileIndex.values()) {
      totalBytes += record.sizeBytes;
      categoryBytes[record.category] = (categoryBytes[record.category] || 0) + record.sizeBytes;
    }

    return {
      totalBytes,
      totalMb: Math.round((totalBytes / (1024 * 1024)) * 10) / 10,
      filesCount: this.fileIndex.size,
      categoryBytes,
    };
  }

  public runLifecycleCleanup(): number {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [id, record] of this.fileIndex.entries()) {
      if (new Date(record.expiresAt).getTime() < now) {
        const fullPath = path.join(STORAGE_ROOT, record.path);
        try {
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath);
          }
          this.fileIndex.delete(id);
          cleanedCount++;
        } catch (err) {
          console.error(`Failed to delete expired file ${fullPath}:`, err);
        }
      }
    }

    return cleanedCount;
  }
}
