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
    expect(prefs.json()).toEqual({
      theme: 'sepia',
      fontSize: 120,
      fontFamily: 'sans',
      lineHeight: 1.8,
      layout: 'auto',
      pageWidth: 'medium',
      pageTurn: 'slide',
      dailyGoal: 20,
    });

    expect((await app.inject({ method: 'DELETE', url: base, headers: { cookie } })).statusCode).toBe(200);
    expect((await app.inject({ url: `${base}/highlights`, headers: { cookie } })).statusCode).toBe(404);
  });
});

describe('estante, edição e estatísticas', () => {
  it('deduz o status, marca como lido ao terminar e aceita status manual', async () => {
    const { cookie } = await register('status@example.com');
    const book = (await upload(cookie, Buffer.from('%PDF-1.4'), 's.pdf')).json();
    expect(book.status).toBe('want');

    const url = `/api/books/${book.id}/progress`;
    await app.inject({ method: 'PUT', url, headers: { cookie }, payload: { location: '2', percent: 0.3 } });
    expect((await app.inject({ url: `/api/books/${book.id}`, headers: { cookie } })).json().status).toBe('reading');

    await app.inject({ method: 'PUT', url, headers: { cookie }, payload: { location: '9', percent: 1 } });
    const done = (await app.inject({ url: `/api/books/${book.id}`, headers: { cookie } })).json();
    expect(done.status).toBe('finished');
    expect(done.finishedAt).toBeTruthy();

    const want = await app.inject({ method: 'PATCH', url: `/api/books/${book.id}`, headers: { cookie }, payload: { status: 'want' } });
    expect(want.json()).toMatchObject({ status: 'want', finishedAt: null });
  });

  it('edita título, autor e capa', async () => {
    const { cookie } = await register('edit@example.com');
    const book = (await upload(cookie, Buffer.from('%PDF-1.4'), 'e.pdf')).json();
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/books/${book.id}`,
      headers: { cookie },
      payload: { title: 'Novo título', author: 'Autora' },
    });
    expect(res.json()).toMatchObject({ title: 'Novo título', author: 'Autora' });
    expect((await app.inject({ method: 'PATCH', url: `/api/books/${book.id}`, headers: { cookie }, payload: { title: '' } })).statusCode).toBe(400);

    const form = new FormData();
    form.append('cover', new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'c.png');
    const cover = await app.inject({ method: 'PUT', url: `/api/books/${book.id}/cover`, headers: { cookie }, payload: form });
    expect(cover.statusCode).toBe(200);
    expect(cover.json()).toMatchObject({ hasCover: true });
    expect(cover.json().coverKey).toMatch(/\.png$/);

    const other = await register('edit2@example.com');
    expect((await app.inject({ method: 'PATCH', url: `/api/books/${book.id}`, headers: { cookie: other.cookie }, payload: { title: 'x' } })).statusCode).toBe(404);
  });

  it('soma o tempo de leitura por dia e lista todos os destaques', async () => {
    const { cookie } = await register('stats@example.com');
    const book = (await upload(cookie, Buffer.from('%PDF-1.4'), 't.pdf')).json();
    const act = `/api/books/${book.id}/activity`;
    await app.inject({ method: 'POST', url: act, headers: { cookie }, payload: { date: '2026-11-20', seconds: 60 } });
    await app.inject({ method: 'POST', url: act, headers: { cookie }, payload: { date: '2026-11-20', seconds: 90 } });
    await app.inject({ method: 'POST', url: act, headers: { cookie }, payload: { date: '2026-11-21', seconds: 30 } });
    expect((await app.inject({ method: 'POST', url: act, headers: { cookie }, payload: { date: 'ontem', seconds: 30 } })).statusCode).toBe(400);

    const stats = (await app.inject({ url: '/api/stats', headers: { cookie } })).json();
    expect(stats.days).toEqual([
      { date: '2026-11-20', seconds: 150 },
      { date: '2026-11-21', seconds: 30 },
    ]);
    expect(stats.books[0]).toMatchObject({ id: book.id, seconds: 180 });

    await app.inject({ method: 'POST', url: `/api/books/${book.id}/highlights`, headers: { cookie }, payload: { location: '1', text: 'trecho' } });
    const all = (await app.inject({ url: '/api/highlights', headers: { cookie } })).json();
    expect(all).toHaveLength(1);
    expect(all[0].book).toMatchObject({ id: book.id, title: book.title });
  });
});
