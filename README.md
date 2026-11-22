# Estante: leitor de livros (EPUB e PDF)

Aplicação web para ler livros EPUB e PDF. O progresso, os marcadores, os destaques e as preferências ficam salvos no servidor, então você começa a ler no computador e continua no celular de onde parou.

## Funcionalidades

- **Biblioteca** com capas (extraídas do EPUB, ou da 1ª página no PDF), barra de progresso e "Continuar lendo"
- **Leitor EPUB** paginado (duas colunas em telas largas), com sumário
- **Leitor PDF** com zoom, sumário (outline) e seleção de texto
- **Sincronização**: salva a posição automaticamente; ao voltar para a aba, avisa "Você leu até 78% no celular. Ir para lá?"
- **Tema** claro, sépia ou escuro; **fonte**, tamanho e espaçamento entre linhas (EPUB)
- **Marcadores** e **destaques** em 4 cores, com nota
- Pensado para o celular: toque nas laterais ou deslize para virar a página; toque no meio para esconder as barras

## Stack

- `web/`: React 19 + Vite + TypeScript, TanStack Query, epub.js, react-pdf (pdf.js)
- `server/`: Fastify + TypeScript, Prisma + SQLite, login com JWT em cookie httpOnly
- Os arquivos dos livros ficam em `server/storage/` e o banco em `server/prisma/dev.db` (os dois estão no `.gitignore`)

## Rodando

```bash
npm install
cp server/.env.example server/.env   # e troque o JWT_SECRET
npm run dev
```

- App: http://localhost:5173 (a API roda em :3000, com proxy pelo Vite)
- **No celular** (na mesma rede Wi-Fi): abra `http://<ip-do-seu-pc>:5173`. O IP aparece no terminal do Vite como "Network"

## Produção

```bash
npm run build
NODE_ENV=production npm start   # um único servidor em :3000 entrega a API e o site
```

Para usar fora de casa, hospede em um servidor (VPS, Railway, Fly.io…) com um **volume persistente** para `server/storage` e `server/prisma`, use HTTPS e defina `COOKIE_SECURE=true` e um `JWT_SECRET` forte. Para trocar SQLite por Postgres, mude o `provider` em `server/prisma/schema.prisma` e o `DATABASE_URL`.

## Testes

```bash
npm test   # testes da API (auth, upload, isolamento entre usuários, progresso, marcadores, destaques)
```
