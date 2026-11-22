import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import { env } from './env.js';
import { COOKIE_NAME } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { bookRoutes } from './routes/books.js';
import { readingRoutes } from './routes/reading.js';

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: 1024 * 1024,
    // atrás do proxy do Render: confia no X-Forwarded-* (IP e https)
    trustProxy: true,
  });

  fs.mkdirSync(env.tmpDir, { recursive: true });

  await app.register(cookie);
  await app.register(jwt, { secret: env.jwtSecret, cookie: { cookieName: COOKIE_NAME, signed: false } });
  await app.register(multipart, { limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 2 } });

  app.setErrorHandler((err: Error & { statusCode?: number }, request, reply) => {
    const status = err.statusCode ?? 500;
    if (status >= 500) request.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Erro interno' : err.message });
  });

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }));
      await api.register(authRoutes);
      await api.register(bookRoutes);
      await api.register(readingRoutes);
    },
    { prefix: '/api' },
  );

  // Em produção, o mesmo servidor entrega o frontend buildado
  if (fs.existsSync(env.webDist)) {
    await app.register(fastifyStatic, { root: env.webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api')) {
        return reply.sendFile('index.html', env.webDist);
      }
      reply.code(404).send({ error: 'Não encontrado' });
    });
  }

  return app;
}
