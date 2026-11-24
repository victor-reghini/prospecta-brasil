import { createWriteStream } from 'fs';
import { mkdir, access } from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface ExportStorage {
  uploadStream(
    key: string,
    bodyStream: Readable,
    contentType: string,
  ): Promise<{ key: string }>;
  getDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  resolveLocalFilePath?(key: string): string;
}

const EXPIRACAO_PADRAO_SEGUNDOS = 24 * 60 * 60; // 24 horas

export class S3ExportStorage implements ExportStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async uploadStream(
    key: string,
    bodyStream: Readable,
    contentType: string,
  ): Promise<{ key: string }> {
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: bodyStream,
        ContentType: contentType,
      },
      queueSize: 4,
      partSize: 5 * 1024 * 1024, // 5 MB por parte
    });

    await upload.done();
    return { key };
  }

  async getDownloadUrl(
    key: string,
    expiresInSeconds = EXPIRACAO_PADRAO_SEGUNDOS,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}

/**
 * Fallback local em streaming para desenvolvimento sem bucket S3/R2 configurado.
 */
export class LocalExportStorage implements ExportStorage {
  constructor(
    private readonly baseDir: string,
    private readonly publicApiBaseUrl = '',
  ) {}

  resolveLocalFilePath(key: string): string {
    const sanitized = path.normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return path.join(this.baseDir, sanitized);
  }

  async uploadStream(
    key: string,
    bodyStream: Readable,
    _contentType: string,
  ): Promise<{ key: string }> {
    const targetPath = this.resolveLocalFilePath(key);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await pipeline(bodyStream, createWriteStream(targetPath));
    return { key };
  }

  async getDownloadUrl(key: string): Promise<string> {
    const targetPath = this.resolveLocalFilePath(key);
    await access(targetPath);
    const encodedKey = encodeURIComponent(key);
    return `${this.publicApiBaseUrl}/api/downloads/${encodedKey}`;
  }
}

export function createStorageFromEnv(): ExportStorage {
  const bucket = process.env.S3_BUCKET?.trim();
  if (bucket) {
    const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
    const region = process.env.S3_REGION?.trim() || 'us-east-1';
    const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();

    const client = new S3Client({
      region,
      endpoint,
      forcePathStyle: Boolean(endpoint),
      credentials:
        accessKeyId && secretAccessKey
          ? { accessKeyId, secretAccessKey }
          : undefined,
    });

    return new S3ExportStorage(client, bucket);
  }

  const localDir = path.resolve(process.env.LOCAL_EXPORT_DIR?.trim() || './exports');
  return new LocalExportStorage(localDir);
}
