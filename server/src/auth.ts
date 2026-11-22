import type { FastifyReply, FastifyRequest } from 'fastify';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

export const COOKIE_NAME = 'token';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 60; // 60 dias

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ error: 'Não autenticado' });
  }
}

export function userId(request: FastifyRequest): string {
  return request.user.sub;
}
