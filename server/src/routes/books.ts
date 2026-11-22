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
import { storage } from '../storage.js';
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
const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};
const imageType = (key: string) => IMAGE_TYPES[path.extname(key).slice(1).toLowerCase()] ?? 'application/octet-stream';
const BOOK_TYPES = { PDF: 'application/pdf', EPUB: 'application/epub+zip' } as const;

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

    const coverRel = `covers/${book.id}-${randomUUID().slice(0, 8)}.${ext}`;
    await storage.put(coverRel, { data }, imageType(coverRel));
    if (book.coverPath) await storage.remove(book.coverPath).catch(() => {});
    const updated = await prisma.book.update({ where: { id: book.id }, data: { coverPath: coverRel } });
    return toPublicBook(updated, book.progress[0]);
  });

  app.post('/books', async (request, reply) => {
    const uid = userId(request);
    const id = randomUUID();
    const tmpPath = path.join(env.tmpDir, `${id}.upload`);
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
            if (part.file.truncated) throw Object.assign(new Error(`Arquivo grande demais (máx. ${env.maxUploadMb}MB)`), { statusCode: 413 });
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

      const finalRel = `${uid}/${id}.${format.toLowerCase()}`;
      const stat = await fs.stat(tmpPath);

      let title = fields.title?.trim() || undefined;
      let author = fields.author?.trim() || undefined;
      let cover = clientCover;

      if (format === 'EPUB') {
        try {
          const meta = await readEpubMeta(await fs.readFile(tmpPath));
          title = meta.title ?? title;
          author = meta.author ?? author;
          cover = meta.cover ?? cover;
        } catch (err) {
          request.log.warn({ err }, 'Falha ao ler metadados do EPUB');
        }
      }

      await storage.put(finalRel, { path: tmpPath }, BOOK_TYPES[format]);
      await fs.rm(tmpPath, { force: true });

      let coverRel: string | null = null;
      if (cover) {
        coverRel = `covers/${id}.${cover.ext}`;
        await storage.put(coverRel, { data: cover.data }, imageType(coverRel));
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
    const file = await storage.get(book.filePath);
    if (!file) return reply.code(404).send({ error: 'Arquivo não encontrado' });
    reply.type(BOOK_TYPES[book.format as keyof typeof BOOK_TYPES] ?? 'application/octet-stream');
    reply.header('Cache-Control', 'private, no-cache');
    if (file.size !== undefined) reply.header('Content-Length', file.size);
    return reply.send(file.stream);
  });

  app.get<{ Params: { id: string } }>('/books/:id/cover', async (request, reply) => {
    const book = await prisma.book.findFirst({ where: { id: request.params.id, userId: userId(request) } });
    if (!book?.coverPath) return reply.code(404).send({ error: 'Sem capa' });
    // Capas SVG vêm de arquivos enviados: nunca deixar executar script se abertas direto
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    reply.header('X-Content-Type-Options', 'nosniff');
    const file = await storage.get(book.coverPath);
    if (!file) return reply.code(404).send({ error: 'Sem capa' });
    reply.type(imageType(book.coverPath));
    reply.header('Cache-Control', 'private, max-age=604800, immutable');
    if (file.size !== undefined) reply.header('Content-Length', file.size);
    return reply.send(file.stream);
  });

  app.delete<{ Params: { id: string } }>('/books/:id', async (request, reply) => {
    const book = await prisma.book.findFirst({ where: { id: request.params.id, userId: userId(request) } });
    if (!book) return reply.code(404).send({ error: 'Livro não encontrado' });
    await prisma.book.delete({ where: { id: book.id } });
    await storage.remove(book.filePath).catch((err) => request.log.warn({ err }, 'Falha ao apagar arquivo'));
    if (book.coverPath) await storage.remove(book.coverPath).catch(() => {});
    return { ok: true };
  });
}
