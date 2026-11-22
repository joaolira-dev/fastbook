import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export default function setup() {
  const dir = path.join(os.tmpdir(), 'leitor-livros-test');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: `file:${path.join(dir, 'test.db')}` },
    stdio: 'ignore',
  });
}
