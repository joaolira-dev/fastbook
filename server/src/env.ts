import 'dotenv/config';
import path from 'node:path';

const serverRoot = path.resolve(import.meta.dirname, '..');

export const env = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-troque-em-producao',
  storageDir: path.resolve(serverRoot, process.env.STORAGE_DIR ?? './storage'),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  webDist: path.resolve(serverRoot, '../web/dist'),
  isProd: process.env.NODE_ENV === 'production',
  /** Pasta para uploads em andamento (no S3, os arquivos só passam por aqui) */
  tmpDir: path.resolve(serverRoot, process.env.TMP_DIR ?? process.env.STORAGE_DIR ?? './storage', 'tmp'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 200),
  storageDriver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3',
  s3: {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    bucket: process.env.S3_BUCKET,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
};
