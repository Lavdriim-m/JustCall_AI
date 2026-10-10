# Deployment

JustCall consists of two services plus a PostgreSQL database:

| Service                                | What it does                                                                       | Needs                                           | Recommended host                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| **web** (`apps/web`, Next.js)          | Admin console, restaurant portal, APIs, invoice PDFs                               | HTTPS, DB                                       | Vercel (fra1) or any Docker host                    |
| **voice** (`apps/voice`, Node/Fastify) | Twilio webhooks + live audio WebSockets, STT/LLM/TTS pipeline, monthly invoice job | **long-running process**, WebSockets, HTTPS, DB | Render or Fly.io (Frankfurt), or any Docker host    |
| **database**                           | PostgreSQL 15+                                                                     | backups                                         | Supabase (Zurich/Frankfurt), Neon, RDS, self-hosted |

The voice server cannot run on serverless platforms (Vercel functions, Lambda) because every call keeps
a WebSocket open for its whole duration.

Both services read the same environment variables (see `.env.example` and [SETUP.md](SETUP.md)).
`INTERNAL_API_SECRET` must be identical on both.

---

## Option A – Vercel (web) + Render (voice) + Supabase · recommended

### 1. Database

Create/run migrations once from your machine (or let Render's pre-deploy command do it):

```bash
DATABASE_URL="postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres" pnpm db:migrate
```

### 2. Voice server on Render

1. <https://render.com> → **New → Blueprint** → select the GitHub repository. Render reads
   [`render.yaml`](../render.yaml) and creates `justcall-voice` and `justcall-web` (you can delete
   the web service there if you use Vercel for it).
2. Fill in the environment group `justcall` (DATABASE_URL, OpenAI, AWS, Twilio, SMTP …). Secrets marked
   `generateValue` are created automatically – copy `INTERNAL_API_SECRET` and `CRON_SECRET` to Vercel.
3. Plan: **Standard** (1 GB RAM) or larger for production; it comfortably handles 50+ simultaneous
   calls per instance (the work is network I/O). Region Frankfurt.
4. Custom domain: `voice.justcall.ch` → set `VOICE_PUBLIC_URL=https://voice.justcall.ch`.
5. The `preDeployCommand` runs `pnpm db:migrate` on every deploy.

### 3. Web app on Vercel

1. <https://vercel.com> → **Add New → Project** → import the repository.
2. **Root Directory:** `apps/web` (Vercel detects Next.js and pnpm; `apps/web/vercel.json` sets region
   `fra1` and the monthly invoice cron).
3. Environment variables: everything from `.env.example` that the web app needs – at least
   `DATABASE_URL`, `APP_URL`, `VOICE_PUBLIC_URL`, `BETTER_AUTH_SECRET`, `INTERNAL_API_SECRET`,
   `CRON_SECRET`, `TWILIO_*` (number management), `SMTP_*`, `EMAIL_FROM`, `OPENAI_API_KEY` (AI menu
   import).
   Use the Supabase **transaction pooler** (port 6543) URL here for serverless, or the session pooler with
   `DATABASE_POOL_MAX=3`.
4. Custom domain `app.justcall.ch` → `APP_URL=https://app.justcall.ch`.

### 4. Twilio

Connect numbers to restaurants in the admin (Restaurant → Phone). Webhooks are configured
automatically with `VOICE_PUBLIC_URL`. If you change the voice domain later, click _Re-apply webhooks_.

### 5. Verify

- `https://app.justcall.ch/admin/system` – all checks green.
- On the voice service shell: `pnpm --filter @justcall/voice doctor` (or `node dist/doctor.js`).
- Call the number from your mobile 🎉

## Option B – Fly.io for the voice server

```bash
fly launch --no-deploy --copy-config --config apps/voice/fly.toml   # from the repository root
fly secrets set DATABASE_URL=… OPENAI_API_KEY=… AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
  TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… INTERNAL_API_SECRET=… BETTER_AUTH_SECRET=… CRON_SECRET=… \
  APP_URL=https://app.justcall.ch VOICE_PUBLIC_URL=https://justcall-voice.fly.dev
fly deploy --config apps/voice/fly.toml --dockerfile apps/voice/Dockerfile .
```

`apps/voice/fly.toml` keeps at least one machine running (no cold starts during calls) and runs
migrations as release command.

## Option C – Your own server (Docker Compose)

Everything in one place, e.g. on a Swiss VPS (Infomaniak, Exoscale, Hetzner):

```bash
git clone https://github.com/Lavdriim-m/JustCall_AI.git && cd JustCall_AI
cp .env.example .env    # fill in; DATABASE_URL is provided by compose (local Postgres)
docker compose up -d --build
```

Put a reverse proxy with automatic HTTPS in front (Caddy example):

```
app.justcall.ch {
  reverse_proxy localhost:3000
}
voice.justcall.ch {
  reverse_proxy localhost:8080
}
```

Caddy proxies WebSockets automatically. Back up the `pgdata` volume (e.g. nightly `pg_dump`).

To use Supabase instead of the bundled Postgres, set `COMPOSE_DATABASE_URL` in `.env`.

## Scaling

- **Voice server**: one instance handles dozens of parallel calls (CPU usage is low; audio transcoding
  is cheap). For high availability run **2+ instances** behind the load balancer – calls are
  independent, and the monthly job uses a database lock so it runs only once. Set a generous shutdown
  timeout (e.g. 30 s+) so deploys drain running calls (`DRAIN_TIMEOUT_SECONDS`).
- **Provider quotas** are the real limits – see [OPERATIONS.md](OPERATIONS.md#capacity-planning-50-parallel-calls).
- **Database**: a small instance is enough (a few writes per call); enable connection pooling.

## Upgrading

```bash
git pull
pnpm install
pnpm db:migrate        # schema changes are versioned SQL in packages/db/drizzle
```

Deploys on Render/Vercel/Fly run the same steps automatically.

Changing the schema: edit `packages/db/src/schema.ts`, then `pnpm db:generate` creates a new SQL
migration – review and commit it.
