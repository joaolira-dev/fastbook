import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { requireAuth, userId } from '../auth.js';
import { readEpubMeta } from '../epub.js';
import { z } from 'zod';
import type { Book as DbBook } from '@prisma/client';

const STATUSES = ['want', 'reading', 'finished'] as const;
type Status = (typeof STATUSES)[number];

const bookPatch = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  author: z.string().trim().max(300).nullish(),
  status: z.enum(STATUSES).nullish(),
});

/** Formato público do livro (o que o frontend recebe). */
export function toPublicBook(b: DbBook, progress?: { percent: number; updatedAt: Date } | null) {
  const percent = progress?.percent ?? 0;
  const status: Status = (b.status as Status | null) ?? (b.finishedAt ? 'finished' : progress ? 'reading' : 'want');
  return {
    id: b.id,
    title: b.title,
    author: b.author,
    format: b.format,
    hasCover: !!b.coverPath,
    // muda quando a capa é trocada: serve para furar o cache do navegador
    coverKey: b.coverPath ? path.basename(b.coverPath) : null,
    createdAt: b.createdAt,
    percent,
    lastReadAt: progress?.updatedAt ?? null,
    status,
    finishedAt: b.finishedAt,
    fileSize: b.fileSize,
  };
}

const IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg']);

async function detectFormat(filePath: string): Promise<'EPUB' | 'PDF' | null> {
  const fh = await fs.open(filePath, 'r');
  try {
    const { buffer } = await fh.read(Buffer.alloc(5), 0, 5, 0);
    if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'PDF';
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'EPUB'; // zip "PK"
    return null;
  } finally {
    await fh.close();
  }
}

function titleFromFilename(name: string) {
  return path.parse(name).name.replace(/[_-]+/g, ' ').trim() || 'Sem título';
}

export async function bookRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/books', async (request) => {
    const uid = userId(request);
    const books = await prisma.book.findMany({
      where: { userId: uid },
      include: { progress: { where: { userId: uid } } },
    });
    return books
      .map((b) => toPublicBook(b, b.progress[0]))
      .sort((a, b) => {
        const ta = new Date(a.lastReadAt ?? a.createdAt).getTime();
        const tb = new Date(b.lastReadAt ?? b.createdAt).getTime();
        return tb - ta;
      });
  });

  app.get<{ Params: { id: string } }>('/books/:id', async (request, reply) => {
    const uid = userId(request);
    const book = await prisma.book.findFirst({
      where: { id: request.params.id, userId: uid },
      include: { progress: { where: { userId: uid } } },
    });
    if (!book) return reply.code(404).send({ error: 'Livro não encontrado' });
    return toPublicBook(book, book.progress[0]);
  });

  app.patch<{ Params: { id: string } }>('/books/:id', async (request, reply) => {
    const parsed = bookPatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });
    const uid = userId(request);
    const book = await prisma.book.findFirst({ where: { id: request.params.id, userId: uid } });
    if (!book) return reply.code(404).send({ error: 'Livro não encontrado' });
    const { title, author, status } = parsed.data;
    const data: Partial<DbBook> = {};
    if (title !== undefined) data.title = title;
    if (author !== undefined) data.author = author || null;
    if (status !== undefined) {
      data.status = status ?? null;
      if (status === 'finished') data.finishedAt = book.finishedAt ?? new Date();
      else data.finishedAt = null;
    }
    const updated = await prisma.book.update({
      where: { id: book.id },
      data,
      include: { progress: { where: { userId: uid } } },
    });
    return toPublicBook(updated, updated.progress[0]);
  });

  app.put<{ Params: { id: string } }>('/books/:id/cover', async (request, reply) => {
    const uid = userId(request);
    const book = await prisma.book.findFirst({
      where: { id: request.params.id, userId: uid },
      include: { progress: { where: { userId: uid } } },
    });
    if (!book) return reply.code(404).send({ error: 'Livro não encontrado' });
    const part = await request.file();
    if (!part) return reply.code(400).send({ error: 'Envie uma imagem' });
    const data = await part.toBuffer();
    const ext = (part.mimetype.split('/')[1] ?? '').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    if (!IMAGE_EXTS.has(ext) || !data.length) return reply.code(400).send({ error: 'Imagem inválida' });
    if (data.length > 8 * 1024 * 1024) return reply.code(413).send({ error: 'Imagem grande demais (máx. 8MB)' });

    await fs.mkdir(path.join(env.storageDir, 'covers'), { recursive: true });
    const coverRel = path.join('covers', `${book.id}-${randomUUID().slice(0, 8)}.${ext}`);
    await fs.writeFile(path.join(env.storageDir, coverRel), data);
    if (book.coverPath) await fs.rm(path.join(env.storageDir, book.coverPath), { force: true });
    const updated = await prisma.book.update({ where: { id: book.id }, data: { coverPath: coverRel } });
    return toPublicBook(updated, book.progress[0]);
  });

  app.post('/books', async (request, reply) => {
    const uid = userId(request);
    const id = randomUUID();
    const userDir = path.join(env.storageDir, uid);
    const coverDir = path.join(env.storageDir, 'covers');
    await fs.mkdir(userDir, { recursive: true });
    await fs.mkdir(coverDir, { recursive: true });

    const tmpPath = path.join(userDir, `${id}.upload`);
    let originalName = '';
    let gotFile = false;
    let clientCover: { data: Buffer; ext: string } | undefined;
    const fields: Record<string, string> = {};

    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname === 'file') {
            originalName = part.filename;
            await pipeline(part.file, createWriteStream(tmpPath));
            if (part.file.truncated) throw Object.assign(new Error('Arquivo grande demais (máx. 200MB)'), { statusCode: 413 });
            gotFile = true;
          } else if (part.fieldname === 'cover') {
            const data = await part.toBuffer();
            const ext = (part.mimetype.split('/')[1] ?? 'jpg').replace('jpeg', 'jpg');
            if (IMAGE_EXTS.has(ext) && data.length > 0) clientCover = { data, ext };
          } else {
            part.file.resume();
          }
        } else if (typeof part.value === 'string') {
          fields[part.fieldname] = part.value.slice(0, 300);
        }
      }

      if (!gotFile) return reply.code(400).send({ error: 'Envie um arquivo no campo "file"' });

      const format = await detectFormat(tmpPath);
      if (!format) {
        await fs.rm(tmpPath, { force: true });
        return reply.code(400).send({ error: 'Formato não suportado. Envie um EPUB ou PDF.' });
      }

      const finalRel = path.join(uid, `${id}.${format.toLowerCase()}`);
      await fs.rename(tmpPath, path.join(env.storageDir, finalRel));
      const stat = await fs.stat(path.join(env.storageDir, finalRel));

      let title = fields.title?.trim() || undefined;
      let author = fields.author?.trim() || undefined;
      let cover = clientCover;

      if (format === 'EPUB') {
        try {
          const meta = await readEpubMeta(await fs.readFile(path.join(env.storageDir, finalRel)));
          title = meta.title ?? title;
          author = meta.author ?? author;
          cover = meta.cover ?? cover;
        } catch (err) {
          request.log.warn({ err }, 'Falha ao ler metadados do EPUB');
        }
      }

      let coverRel: string | null = null;
      if (cover) {
        coverRel = path.join('covers', `${id}.${cover.ext}`);
        await fs.writeFile(path.join(env.storageDir, coverRel), cover.data);
      }

      const book = await prisma.book.create({
        data: {
          id,
          userId: uid,
          title: title ?? titleFromFilename(originalName),
          author: author ?? null,
          format,
          filePath: finalRel,
          fileSize: stat.size,
          coverPath: coverRel,
        },
      });

      return reply.code(201).send(toPublicBook(book, null));
    } catch (err) {
      await fs.rm(tmpPath, { force: true });
      throw err;
    }
  });

  app.get<{ Params: { id: string } }>('/books/:id/file', async (request, reply) => {
    const book = await prisma.book.findFirst({ where: { id: request.params.id, userId: userId(request) } });
    if (!book) return reply.code(404).send({ error: 'Livro não encontrado' });
    reply.type(book.format === 'PDF' ? 'application/pdf' : 'application/epub+zip');
    return reply.sendFile(book.filePath, env.storageDir, { cacheControl: false });
  });

  app.get<{ Params: { id: string } }>('/books/:id/cover', async (request, reply) => {
    const book = await prisma.book.findFirst({ where: { id: request.params.id, userId: userId(request) } });
    if (!book?.coverPath) return reply.code(404).send({ error: 'Sem capa' });
    // Capas SVG vêm de arquivos enviados: nunca deixar executar script se abertas direto
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    reply.header('X-Content-Type-Options', 'nosniff');
    return reply.sendFile(book.coverPath, env.storageDir, { maxAge: '7d', immutable: true });
  });

  app.delete<{ Params: { id: string } }>('/books/:id', async (request, reply) => {
    const book = await prisma.book.findFirst({ where: { id: request.params.id, userId: userId(request) } });
    if (!book) return reply.code(404).send({ error: 'Livro não encontrado' });
    await prisma.book.delete({ where: { id: book.id } });
    await fs.rm(path.join(env.storageDir, book.filePath), { force: true });
    if (book.coverPath) await fs.rm(path.join(env.storageDir, book.coverPath), { force: true });
    return { ok: true };
  });
}
