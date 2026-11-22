// Gera prisma/postgres.prisma a partir do schema SQLite (usado no deploy com Postgres/Supabase)
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(import.meta.dirname, '../prisma');
const src = fs.readFileSync(path.join(dir, 'schema.prisma'), 'utf8');
const out = src.replace(/provider\s*=\s*"sqlite"/, 'provider = "postgresql"');
if (out === src) throw new Error('provider "sqlite" não encontrado no schema.prisma');
fs.writeFileSync(path.join(dir, 'postgres.prisma'), `// GERADO por scripts/pg-schema.mjs — não edite\n${out}`);
console.log('prisma/postgres.prisma gerado');
