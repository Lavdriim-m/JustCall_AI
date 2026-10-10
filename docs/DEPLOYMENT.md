# Deployment

JustCall consists of two services plus a PostgreSQL database:

| Service                                | What it does                                                                       | Needs                                           | Recommended host                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| **web** (`apps/web`, Next.js)          | Admin console, restaurant portal, APIs, invoice PDFs                               | HTTPS, DB                                       | Vercel Pro (fra1) or any Docker host                |
| **voice** (`apps/voice`, Node/Fastify) | Twilio webhooks + live audio WebSockets, STT/LLM/TTS pipeline, monthly invoice job | **long-running process**, WebSockets, HTTPS, DB | Render or Fly.io (Frankfurt), or any Docker host    |
| **database**                           | PostgreSQL 15+                                                                     | backups                                         | Supabase (Zurich/Frankfurt), Neon, RDS, self-hosted |

The voice server cannot run on serverless platforms (Vercel functions, Lambda) because every call keeps
a WebSocket open for its whole duration.

Each service reads only its own subset of the environment variables – the
[environment variable reference](SETUP.md#environment-variable-reference) lists which service needs
what. `INTERNAL_API_SECRET` must be identical on both.

---

## Option A – Vercel (web) + Render (voice) + Supabase · recommended

### 1. Database

In Supabase, open **Connect** and copy the pooler URIs exactly as shown: the **Session pooler**
(port 5432) for the voice server and migrations, the **Transaction pooler** (port 6543) for Vercel.
Never build the host by hand – it is `aws-<index>-<region>.pooler.supabase.com`, and the index
(`aws-0`, `aws-1`, …) differs between projects. Percent-encode special characters in the password.

Run migrations once from your machine (or let Render's pre-deploy command do it):

```bash
DATABASE_URL="<session pooler URI from Supabase Connect>" pnpm db:migrate
```

The session pooler's **Pool Size** (Supabase → Database → Settings) caps the connections it accepts.
`DATABASE_POOL_MAX` (default 10) × voice instances, plus migrations, must stay below it – raise Pool
Size or lower `DATABASE_POOL_MAX` otherwise.

### 2. Voice server on Render

1. <https://render.com> → **New → Blueprint** → select the GitHub repository. Render reads
   [`render.yaml`](../render.yaml) and creates the `justcall-voice` service and the environment group
   `justcall` (fixed settings plus the generated `BETTER_AUTH_SECRET`, `INTERNAL_API_SECRET` and
   `CRON_SECRET`). The web service is commented out there; uncomment it only if you host the web app on
   Render instead of Vercel.
2. Render asks for each voice secret: `DATABASE_URL` (session pooler), `APP_URL`, `VOICE_PUBLIC_URL`,
   `OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`. It asks only when the
   Blueprint is first created – add later secrets (or all of them, if your Blueprint was created from
   an older `render.yaml`) under _justcall-voice → Environment_, then run a **Manual Deploy**.
3. Copy `INTERNAL_API_SECRET` (must be identical) and `BETTER_AUTH_SECRET` from the `justcall` group to
   Vercel.
4. Plan: **1c-2g** (formerly Standard; 1 CPU / 2 GB RAM) or larger for production. `render.yaml` still
   uses the legacy ID `standard`, which Blueprints accept. One instance comfortably handles 50+
   simultaneous calls (the work is network I/O). Region Frankfurt.
5. Custom domain: `voice.justcall.ch` → set `VOICE_PUBLIC_URL=https://voice.justcall.ch`.
6. The `preDeployCommand` runs `pnpm db:migrate` on every deploy.
7. Deploys and live calls: Render stops the old instance with SIGTERM once the new one is live and kills
   it after `maxShutdownDelaySeconds` (300 here; Render's default is 30). The voice server waits up to
   `DRAIN_TIMEOUT_SECONDS` (290) for running calls, then hangs up the rest. Deploying outside opening
   hours is still safest.

### 3. Web app on Vercel

1. Plan: **Vercel Pro**. Hobby is limited to non-commercial personal use, and JustCall is a paid service.
2. <https://vercel.com> → **Add New → Project** → import the repository.
3. **Root Directory:** `apps/web` (Vercel detects Next.js and pnpm; `apps/web/vercel.json` pins the
   functions to `fra1`).
4. Environment variables:
   - **Required:** `DATABASE_URL`, `DATABASE_POOL_MAX`, `APP_URL`, `VOICE_PUBLIC_URL`,
     `BETTER_AUTH_SECRET`, `INTERNAL_API_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (number
     management, fallback signature check), `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`,
     `OPENAI_API_KEY` (AI menu import – the web app's only language-model feature, so it is needed
     even when calls use `LLM_PROVIDER=anthropic`).
   - **Buying Swiss numbers in the app:** `TWILIO_CH_BUNDLE_SID`, `TWILIO_CH_ADDRESS_SID`.
   - **Optional:** `SMTP_PORT` (default 465), `OPENAI_MODEL`, `OPENAI_MENU_MODEL` (menu import,
     defaults to `OPENAI_MODEL`), `OPENAI_BASE_URL` (Azure OpenAI / proxy), `TWILIO_EDGE`, `TWILIO_VALIDATE_SIGNATURES` (leave
     unset = `true`), `VOICE_INTERNAL_URL` (server-to-server voice URL; leave unset on Vercel, it falls
     back to `VOICE_PUBLIC_URL`), `CRON_SECRET` (only for an external invoice scheduler, see below).

   `DATABASE_URL` here is the Supabase **transaction pooler** URI (port 6543; JustCall turns off
   prepared statements for it) with `DATABASE_POOL_MAX=1` to `3`, because every serverless instance
   opens its own pool.

5. Custom domain `app.justcall.ch` → `APP_URL=https://app.justcall.ch`.

### 4. Twilio

Connect numbers to restaurants in the admin (Restaurant → Phone). Webhooks are configured
automatically with `VOICE_PUBLIC_URL`. If you change the voice domain later, click _Re-apply webhooks_.

### 5. Monthly invoices

The voice server generates the invoices on the 1st of the month at 06:00 (Europe/Zurich) and catches
up after a restart. A database lock makes it run once even with several instances, and it sends them
when `INVOICE_AUTO_SEND=true`. There is no Vercel cron.

`GET /api/cron/monthly-invoices` (header `Authorization: Bearer $CRON_SECRET`) on the web app is only
for setups that set `JOBS_ENABLED=false` on the voice server and trigger invoicing from an external
scheduler. It only generates invoices – send them from _Invoices_ in the admin. Don't use it while the
voice job is enabled: if it runs first, the voice job finds the invoices already created and sends
nothing. Note that `JOBS_ENABLED=false` also stops the daily maintenance (transcript deletion after
`TRANSCRIPT_RETENTION_DAYS`, stale-call cleanup), which nothing else runs – keep the voice job on
unless you have a reason not to.

### 6. Verify

- `https://app.justcall.ch/admin/system` – all checks green.
- On the voice service shell: `pnpm --filter @justcall/voice doctor` (or `node dist/doctor.js`).
- Call the number from your mobile 🎉

## Option B – Fly.io for the voice server

```bash
# from the repository root
fly launch --no-deploy --copy-config --config apps/voice/fly.toml
fly secrets set --config apps/voice/fly.toml --stage DATABASE_URL=… OPENAI_API_KEY=… \
  AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… \
  SMTP_HOST=… SMTP_USER=… SMTP_PASSWORD=… EMAIL_FROM=… INTERNAL_API_SECRET=… \
  APP_URL=https://app.justcall.ch VOICE_PUBLIC_URL=https://justcall-voice.fly.dev
fly deploy --config apps/voice/fly.toml --dockerfile apps/voice/Dockerfile .
```

- Fly app names are global. If `justcall-voice` is taken, change `app` in `apps/voice/fly.toml`;
  `VOICE_PUBLIC_URL` must then be `https://<your-app-name>.fly.dev` (or your custom domain).
- `fly launch` / `fly deploy` create **2 machines** by default (`--ha=true`), which doubles the cost
  because machines never stop. Pass `--ha=false` to both for a single machine.
- `apps/voice/fly.toml` keeps at least one machine running (no cold starts during calls), runs
  migrations as release command, sets `TWILIO_SMS_FROM=JustCall`, and gives running calls up to
  290 s to finish on deploys (`DRAIN_TIMEOUT_SECONDS=290` inside Fly's `kill_timeout = 300`). While it
  drains, new calls are forwarded to the restaurant's transfer number (restaurants without one are
  still answered by the assistant). With a single machine, a
  deploy replaces that machine, so deploy outside opening hours.
- `INTERNAL_API_SECRET` must be the same value as on the web app. The voice server does not read
  `BETTER_AUTH_SECRET` or `CRON_SECRET`.

## Option C – Your own server (Docker Compose)

Everything in one place, e.g. on a Swiss VPS (Infomaniak, Exoscale, Hetzner):

```bash
git clone https://github.com/Lavdriim-m/JustCall_AI.git && cd JustCall_AI
cp .env.example .env    # fill in; DATABASE_URL is provided by compose (local Postgres)
docker compose up -d --build
```

Both images run with `NODE_ENV=production`, so `.env` must contain `BETTER_AUTH_SECRET` and
`INTERNAL_API_SECRET` (`openssl rand -base64 32` each); without them the voice server exits and the web
app fails on the first request. Set `POSTGRES_PASSWORD` in `.env` before the first start (letters and digits only – compose puts it
into the database URL as is). Postgres applies it only when the `pgdata` volume is created; to change
it later, also run
`docker compose exec db psql -U justcall -c "ALTER USER justcall PASSWORD '<new>'"`.

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

When the voice container is stopped, running calls get up to 290 s to finish
(`DRAIN_TIMEOUT_SECONDS=290` inside `stop_grace_period: 300s`), and new calls are forwarded to the
restaurant's transfer number meanwhile (restaurants without one are still answered by the
assistant). `docker compose up` stops the old container before it starts the new one, so update
outside opening hours.

## Scaling

- **Voice server**: one instance handles dozens of parallel calls (CPU usage is low; audio transcoding
  is cheap). For high availability run **2+ instances** behind the load balancer – calls are
  independent, and the monthly job uses a database lock so it runs only once. On shutdown the voice
  server forwards new calls to the restaurant's transfer number (or still answers them when there is
  none), counts calls whose audio stream is still connecting, answers `/health` with 503 and gives running calls up
  to `DRAIN_TIMEOUT_SECONDS` to finish (default 25; the shipped configs set 290, a few seconds below
  the 300 s maximum on Render and Fly). Calls longer than that are cut.
- **Provider quotas** are the real limits – see [OPERATIONS.md](OPERATIONS.md#capacity-planning-50-parallel-calls).
- **Database**: a small instance is enough (a few writes per call); use the Supabase poolers as above
  and keep `DATABASE_POOL_MAX` × instances below the session pooler's Pool Size.

## Upgrading

```bash
git pull
pnpm install
pnpm db:migrate        # schema changes are versioned SQL in packages/db/drizzle
```

Render (`preDeployCommand`) and Fly (`release_command`) run `pnpm db:migrate` automatically on every
voice deploy; Vercel does not run migrations. When an update changes the schema, let the voice deploy
(and its migration) finish before the web deploy goes live, or run `pnpm db:migrate` yourself first.

Changing the schema: edit `packages/db/src/schema.ts`, then `pnpm db:generate` creates a new SQL
migration – review and commit it.
