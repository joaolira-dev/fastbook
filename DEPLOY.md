# Deploy gratuito: Render + Supabase

O app roda no **Render** (plano free) e guarda banco e arquivos no **Supabase** (plano free).

> Limites do plano gratuito: o Render "dorme" após ~15 min sem acesso e leva ~1 min para acordar;
> o Supabase dá 500 MB de banco e 1 GB de arquivos, com no máximo 50 MB por livro.

## 1. Supabase (banco + arquivos)

1. Crie um projeto em https://supabase.com (anote a senha do banco).
2. **Banco** → botão **Connect** → aba *Connection string* → **Session pooler** (porta 5432).
   Copie a URL e troque `[YOUR-PASSWORD]` pela senha. Ela é o `DATABASE_URL`.
3. **Storage** → **New bucket** → nome `books`, **privado** (deixe "Public bucket" desligado).
4. **Storage** → **S3 Configuration** (em *Settings*):
   - copie o **Endpoint** → `S3_ENDPOINT` (algo como `https://<ref>.storage.supabase.co/storage/v1/s3`)
   - copie a **Region** → `S3_REGION` (ex.: `sa-east-1`)
   - em **S3 Access Keys** → *New access key* → copie **Access key ID** e **Secret access key**
     → `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY`

## 2. Render (app)

1. Em https://render.com, entre com o GitHub (conta `joaolira-dev`).
2. **New** → **Blueprint** → escolha o repositório `fastbook`. O Render lê o `render.yaml`.
3. Ele pede os 5 valores marcados como "sync: false": cole `DATABASE_URL`, `S3_ENDPOINT`,
   `S3_REGION`, `S3_ACCESS_KEY_ID` e `S3_SECRET_ACCESS_KEY` do passo 1.
4. **Apply**. O primeiro build leva alguns minutos; as tabelas são criadas sozinhas na primeira subida.
5. O endereço fica em `https://fastbook-xxxx.onrender.com`. Crie sua conta pelo próprio app.

Cada `git push` na `main` faz um novo deploy automaticamente.

## Rodando localmente

Nada muda: `npm run dev` continua usando SQLite e a pasta `server/storage`.
