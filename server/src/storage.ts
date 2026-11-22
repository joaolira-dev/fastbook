import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';

/**
 * Onde ficam os arquivos dos livros e das capas.
 * - "local": pasta no disco (desenvolvimento, ou servidor com disco permanente)
 * - "s3": qualquer armazenamento compatível com S3 (Supabase Storage, R2, MinIO…)
 * As chaves usam "/" (ex.: "<usuario>/<id>.epub", "covers/<id>.jpg").
 */
export interface Storage {
  /** Grava a partir de um arquivo local (temporário) ou de um buffer */
  put(key: string, source: { path: string } | { data: Buffer }, contentType: string): Promise<void>;
  get(key: string): Promise<{ stream: Readable; size?: number } | null>;
  remove(key: string): Promise<void>;
}

const toKey = (key: string) => key.split(path.sep).join('/');

function localStorage(root: string): Storage {
  const abs = (key: string) => {
    const p = path.resolve(root, toKey(key));
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error('Chave inválida');
    return p;
  };
  return {
    async put(key, source) {
      const dest = abs(key);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      if ('path' in source) await fs.copyFile(source.path, dest);
      else await fs.writeFile(dest, source.data);
    },
    async get(key) {
      try {
        const p = abs(key);
        const { size } = await fs.stat(p);
        return { stream: createReadStream(p), size };
      } catch {
        return null;
      }
    },
    async remove(key) {
      await fs.rm(abs(key), { force: true });
    },
  };
}

function s3Storage(): Storage {
  const { endpoint, region, bucket, accessKeyId, secretAccessKey } = env.s3;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error('STORAGE_DRIVER=s3 exige S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID e S3_SECRET_ACCESS_KEY');
  }
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  return {
    async put(key, source, contentType) {
      const body = 'path' in source ? createReadStream(source.path) : source.data;
      const size = 'path' in source ? (await fs.stat(source.path)).size : source.data.length;
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: toKey(key), Body: body, ContentLength: size, ContentType: contentType }),
      );
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: toKey(key) }));
        return { stream: res.Body as Readable, size: res.ContentLength };
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: toKey(key) }));
    },
  };
}

export const storage: Storage = env.storageDriver === 's3' ? s3Storage() : localStorage(env.storageDir);
