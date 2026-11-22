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
};
