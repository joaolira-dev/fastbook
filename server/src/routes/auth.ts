import type { FastifyInstance, FastifyReply } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { COOKIE_MAX_AGE, COOKIE_NAME, requireAuth, userId } from '../auth.js';

const registerBody = z.object({
  email: z.string().trim().toLowerCase().email('E-mail inválido'),
  password: z.string().min(6, 'A senha precisa ter pelo menos 6 caracteres'),
  name: z.string().trim().max(80).optional(),
});

const loginBody = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string(),
});

function publicUser(u: { id: string; email: string; name: string | null }) {
  return { id: u.id, email: u.email, name: u.name };
}

async function setSession(app: FastifyInstance, reply: FastifyReply, u: { id: string; email: string }) {
  const token = app.jwt.sign({ sub: u.id, email: u.email }, { expiresIn: COOKIE_MAX_AGE });
  reply.setCookie(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', async (request, reply) => {
    const parsed = registerBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0].message });
    const { email, password, name } = parsed.data;

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return reply.code(409).send({ error: 'Já existe uma conta com esse e-mail' });

    const user = await prisma.user.create({
      data: { email, name, passwordHash: await bcrypt.hash(password, 10) },
    });
    await setSession(app, reply, user);
    return reply.code(201).send({ user: publicUser(user) });
  });

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Dados inválidos' });
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'E-mail ou senha incorretos' });
    }
    await setSession(app, reply, user);
    return { user: publicUser(user) };
  });

  app.post('/auth/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { preHandler: requireAuth }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: userId(request) } });
    if (!user) return reply.code(401).send({ error: 'Não autenticado' });
    return { user: publicUser(user) };
  });
}
