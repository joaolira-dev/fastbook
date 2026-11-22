import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { requireAuth, userId } from '../auth.js';

type BookParams = { Params: { id: string } };
type ItemParams = { Params: { id: string; itemId: string } };

async function ownBook(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const book = await prisma.book.findFirst({
    where: { id: request.params.id, userId: userId(request) },
    select: { id: true },
  });
  if (!book) {
    reply.code(404).send({ error: 'Livro não encontrado' });
    return null;
  }
  return book;
}

const progressBody = z.object({
  location: z.string().min(1).max(2000),
  percent: z.number().min(0).max(1),
  updatedAt: z.coerce.date().optional(),
  device: z.string().max(100).optional(),
});

const bookmarkBody = z.object({
  location: z.string().min(1).max(2000),
  label: z.string().max(300).default(''),
});

const COLORS = ['yellow', 'green', 'blue', 'pink'] as const;

const highlightBody = z.object({
  location: z.string().min(1).max(4000),
  text: z.string().max(5000),
  color: z.enum(COLORS).default('yellow'),
  note: z.string().max(5000).nullish(),
});

const highlightPatch = z.object({
  color: z.enum(COLORS).optional(),
  note: z.string().max(5000).nullish(),
});

const preferencesBody = z.object({
  theme: z.enum(['light', 'dark', 'sepia']),
  fontSize: z.number().int().min(60).max(250),
  fontFamily: z.enum(['serif', 'sans', 'mono']),
  lineHeight: z.number().min(1).max(2.5),
});

const DEFAULT_PREFS = { theme: 'light', fontSize: 100, fontFamily: 'serif', lineHeight: 1.6 };

export async function readingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  // ---- Progresso ----
  app.get<BookParams>('/books/:id/progress', async (request, reply) => {
    if (!(await ownBook(request, reply))) return;
    const p = await prisma.progress.findUnique({
      where: { userId_bookId: { userId: userId(request), bookId: request.params.id } },
    });
    return { progress: p };
  });

  app.put<BookParams>('/books/:id/progress', async (request, reply) => {
    if (!(await ownBook(request, reply))) return;
    const parsed = progressBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Progresso inválido' });
    const uid = userId(request);
    const bookId = request.params.id;
    const now = new Date();
    // Não aceita datas no futuro (relógio adiantado de algum aparelho)
    const updatedAt = parsed.data.updatedAt && parsed.data.updatedAt < now ? parsed.data.updatedAt : now;

    const existing = await prisma.progress.findUnique({ where: { userId_bookId: { userId: uid, bookId } } });
    // Last-write-wins: ignora atualizações mais antigas que a que já está salva
    if (existing && existing.updatedAt > updatedAt) {
      return { progress: existing, applied: false };
    }

    const data = { location: parsed.data.location, percent: parsed.data.percent, device: parsed.data.device, updatedAt };
    const progress = await prisma.progress.upsert({
      where: { userId_bookId: { userId: uid, bookId } },
      create: { userId: uid, bookId, ...data },
      update: data,
    });
    return { progress, applied: true };
  });

  // ---- Marcadores ----
  app.get<BookParams>('/books/:id/bookmarks', async (request, reply) => {
    if (!(await ownBook(request, reply))) return;
    return prisma.bookmark.findMany({
      where: { bookId: request.params.id, userId: userId(request) },
      orderBy: { createdAt: 'asc' },
    });
  });

  app.post<BookParams>('/books/:id/bookmarks', async (request, reply) => {
    if (!(await ownBook(request, reply))) return;
    const parsed = bookmarkBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Marcador inválido' });
    const bm = await prisma.bookmark.create({
      data: { ...parsed.data, bookId: request.params.id, userId: userId(request) },
    });
    return reply.code(201).send(bm);
  });

  app.delete<ItemParams>('/books/:id/bookmarks/:itemId', async (request, reply) => {
    const { count } = await prisma.bookmark.deleteMany({
      where: { id: request.params.itemId, bookId: request.params.id, userId: userId(request) },
    });
    if (!count) return reply.code(404).send({ error: 'Marcador não encontrado' });
    return { ok: true };
  });

  // ---- Destaques ----
  app.get<BookParams>('/books/:id/highlights', async (request, reply) => {
    if (!(await ownBook(request, reply))) return;
    return prisma.highlight.findMany({
      where: { bookId: request.params.id, userId: userId(request) },
      orderBy: { createdAt: 'asc' },
    });
  });

  app.post<BookParams>('/books/:id/highlights', async (request, reply) => {
    if (!(await ownBook(request, reply))) return;
    const parsed = highlightBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Destaque inválido' });
    const hl = await prisma.highlight.create({
      data: { ...parsed.data, note: parsed.data.note ?? null, bookId: request.params.id, userId: userId(request) },
    });
    return reply.code(201).send(hl);
  });

  app.patch<ItemParams>('/books/:id/highlights/:itemId', async (request, reply) => {
    const parsed = highlightPatch.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Destaque inválido' });
    const where = { id: request.params.itemId, bookId: request.params.id, userId: userId(request) };
    const { count } = await prisma.highlight.updateMany({ where, data: parsed.data });
    if (!count) return reply.code(404).send({ error: 'Destaque não encontrado' });
    return prisma.highlight.findUnique({ where: { id: request.params.itemId } });
  });

  app.delete<ItemParams>('/books/:id/highlights/:itemId', async (request, reply) => {
    const { count } = await prisma.highlight.deleteMany({
      where: { id: request.params.itemId, bookId: request.params.id, userId: userId(request) },
    });
    if (!count) return reply.code(404).send({ error: 'Destaque não encontrado' });
    return { ok: true };
  });

  // ---- Preferências ----
  app.get('/preferences', async (request) => {
    const prefs = await prisma.preferences.findUnique({ where: { userId: userId(request) } });
    if (!prefs) return DEFAULT_PREFS;
    const { userId: _u, ...rest } = prefs;
    return rest;
  });

  app.put('/preferences', async (request, reply) => {
    const parsed = preferencesBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Preferências inválidas' });
    const uid = userId(request);
    const prefs = await prisma.preferences.upsert({
      where: { userId: uid },
      create: { userId: uid, ...parsed.data },
      update: parsed.data,
    });
    const { userId: _u, ...rest } = prefs;
    return rest;
  });
}
