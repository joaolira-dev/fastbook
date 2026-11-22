import path from 'node:path';
import os from 'node:os';

const dir = path.join(os.tmpdir(), 'leitor-livros-test');
process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
process.env.STORAGE_DIR = path.join(dir, 'storage');
process.env.JWT_SECRET = 'test-secret';
