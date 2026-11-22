import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

let app: FastifyInstance;

async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Dom Casmurro</dc:title><dc:creator id="a">Machado de Assis</dc:creator>
      </metadata>
      <manifest>
        <item id="c" href="images/capa.png" media-type="image/png" properties="cover-image"/>
        <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
      </manifest>
      <spine><itemref idref="ch1"/></spine></package>`,
  );
  zip.file('OEBPS/ch1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Olá</p></body></html>');
  zip.file('OEBPS/images/capa.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function register(email: string) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'segredo123' } });
  expect(res.statusCode).toBe(201);
  const cookie = res.cookies.find((c) => c.name === 'token')!;
  return { cookie: `token=${cookie.value}` };
}

async function upload(cookie: string, buf: Buffer, filename: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  form.append('file', new Blob([buf]), filename);
  return app.inject({ method: 'POST', url: '/api/books', headers: { cookie }, payload: form });
}

beforeAll(async () => {
  app = await buildApp({ logger: false });
});
afterAll(async () => {
  await app.close();
});

describe('auth', () => {
  it('registra, faz login e lê /me', async () => {
    const { cookie } = await register('ana@example.com');
    const me = await app.inject({ url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user.email).toBe('ana@example.com');

    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ana@example.com', password: 'x' } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'ANA@example.com', password: 'segredo123' } });
    expect(ok.statusCode).toBe(200);
  });

  it('bloqueia rotas sem login e e-mail duplicado', async () => {
    expect((await app.inject({ url: '/api/books' })).statusCode).toBe(401);
    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'ana@example.com', password: 'segredo123' } });
    expect(dup.statusCode).toBe(409);
  });
});

describe('livros e leitura', () => {
  it('faz upload de EPUB extraindo título, autor e capa', async () => {
    const { cookie } = await register('epub@example.com');
    const res = await upload(cookie, await makeEpub(), 'arquivo.epub');
    expect(res.statusCode).toBe(201);
    const book = res.json();
    expect(book).toMatchObject({ title: 'Dom Casmurro', author: 'Machado de Assis', format: 'EPUB', hasCover: true });

    const cover = await app.inject({ url: `/api/books/${book.id}/cover`, headers: { cookie } });
    expect(cover.statusCode).toBe(200);
    const file = await app.inject({ url: `/api/books/${book.id}/file`, headers: { cookie } });
    expect(file.statusCode).toBe(200);
    expect(file.headers['content-type']).toContain('application/epub+zip');
  });

  it('aceita PDF com título vindo do cliente e recusa outros formatos', async () => {
    const { cookie } = await register('pdf@example.com');
    const res = await upload(cookie, Buffer.from('%PDF-1.4\n%%EOF'), 'meu_livro.pdf', { title: 'Livro PDF' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: 'Livro PDF', format: 'PDF', hasCover: false });

    const bad = await upload(cookie, Buffer.from('texto qualquer'), 'x.txt');
    expect(bad.statusCode).toBe(400);
  });

  it('isola livros entre usuários', async () => {
    const a = await register('a@example.com');
    const b = await register('b@example.com');
    const book = (await upload(a.cookie, Buffer.from('%PDF-1.4'), 'a.pdf')).json();
    const other = await app.inject({ url: `/api/books/${book.id}/file`, headers: { cookie: b.cookie } });
    expect(other.statusCode).toBe(404);
    const list = await app.inject({ url: '/api/books', headers: { cookie: b.cookie } });
    expect(list.json()).toEqual([]);
  });

  it('salva progresso com last-write-wins', async () => {
    const { cookie } = await register('prog@example.com');
    const book = (await upload(cookie, Buffer.from('%PDF-1.4'), 'p.pdf')).json();
    const url = `/api/books/${book.id}/progress`;

    const t2 = new Date(Date.now() - 1000).toISOString();
    const t1 = new Date(Date.now() - 5000).toISOString();
    const first = await app.inject({ method: 'PUT', url, headers: { cookie }, payload: { location: '10', percent: 0.5, updatedAt: t2, device: 'pc' } });
    expect(first.json().applied).toBe(true);

    const stale = await app.inject({ method: 'PUT', url, headers: { cookie }, payload: { location: '3', percent: 0.1, updatedAt: t1, device: 'celular' } });
    expect(stale.json().applied).toBe(false);

    const got = await app.inject({ url, headers: { cookie } });
    expect(got.json().progress).toMatchObject({ location: '10', percent: 0.5, device: 'pc' });

    const list = await app.inject({ url: '/api/books', headers: { cookie } });
    expect(list.json()[0].percent).toBe(0.5);
  });

  it('CRUD de marcadores, destaques e preferências', async () => {
    const { cookie } = await register('notes@example.com');
    const book = (await upload(cookie, Buffer.from('%PDF-1.4'), 'n.pdf')).json();
    const base = `/api/books/${book.id}`;

    const bm = await app.inject({ method: 'POST', url: `${base}/bookmarks`, headers: { cookie }, payload: { location: '4', label: 'Página 4' } });
    expect(bm.statusCode).toBe(201);
    expect((await app.inject({ url: `${base}/bookmarks`, headers: { cookie } })).json()).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `${base}/bookmarks/${bm.json().id}`, headers: { cookie } })).statusCode).toBe(200);

    const hl = await app.inject({ method: 'POST', url: `${base}/highlights`, headers: { cookie }, payload: { location: '2', text: 'frase', color: 'green' } });
    expect(hl.statusCode).toBe(201);
    const patched = await app.inject({ method: 'PATCH', url: `${base}/highlights/${hl.json().id}`, headers: { cookie }, payload: { note: 'boa' } });
    expect(patched.json()).toMatchObject({ note: 'boa', color: 'green' });

    expect((await app.inject({ url: '/api/preferences', headers: { cookie } })).json().theme).toBe('light');
    const prefs = await app.inject({ method: 'PUT', url: '/api/preferences', headers: { cookie }, payload: { theme: 'sepia', fontSize: 120, fontFamily: 'sans', lineHeight: 1.8 } });
    expect(prefs.json()).toEqual({ theme: 'sepia', fontSize: 120, fontFamily: 'sans', lineHeight: 1.8 });

    expect((await app.inject({ method: 'DELETE', url: base, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: `${base}/highlights`, headers: { cookie } })).statusCode).toBe(404);
  });
});
