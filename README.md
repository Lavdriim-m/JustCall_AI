# JustCall – AI phone ordering for restaurants (Swiss German)

JustCall answers restaurant phone calls with an AI assistant that understands **Swiss German**, takes
complete orders, reads them back, confirms them, sends an SMS with the order number and payment
instructions (cash / card / TWINT), and puts the order on the restaurant's live orders board. During
rush hour it handles **dozens of calls at the same time**. Allergy questions and requests for the owner
are transferred to a human. Every order is logged and billed with a monthly commission invoice
(Swiss QR-bill).

<p>
<b>Admin console</b> – onboard restaurants, menus with aliases (<i>"Combo 3" = "Pizza Napoli"</i>), option groups,
opening hours, phone numbers, test calls in the browser, call transcripts, orders, invoices.<br/>
<b>Restaurant portal</b> – live orders board with sound, sold-out switches, bot pause, rush-hour waiting time,
invoices.
</p>

## Features

- 📞 **Phone**: Twilio numbers; restaurants keep their number and forward (always or on busy/no answer)
- 🗣️ **Swiss German**: streaming speech recognition `de-CH` (AWS Transcribe or Azure), Swiss voice
  (Polly _Sabrina_, Azure _Leni/Jan_, ElevenLabs), menu words boost recognition
- 🧠 **Reliable ordering**: the LLM (OpenAI/Claude) talks; the server computes prices, validates
  options, opening hours, delivery area and only confirms after a full read-back and an explicit "yes"
- 🛡️ **Safety**: deterministic allergy detection → transfer to staff; owner requests → transfer;
  barge-in, silence handling, technical fallback to the restaurant
- 🔁 **Aliases & codes**: any number of names per item and option, fuzzy matching for transcription
  errors, live "what would the assistant understand" tester
- 🧾 **Billing**: commission %, monthly and per-order fees, VAT, automatic monthly draft invoices,
  PDF with Swiss QR-bill, email sending, paid/void tracking
- 🍕 **Menu import**: AI from pasted text or a photo of the menu, CSV, JSON (export/import)
- 🧪 **Testing**: browser test calls (text or microphone, same pipeline as phone calls), terminal chat,
  conversation evals against the real model, unit/integration/e2e tests
- 🔐 **SaaS basics**: roles (admin/owner/staff), invitations, audit log, password reset, dark mode,
  health checks, Docker, CI

## Quick start (local, no API keys needed)

Requirements: Node.js 22, pnpm 10, PostgreSQL 15+ (or Docker).

```bash
pnpm install
cp .env.example .env
# in .env: set DATABASE_URL, and for a keyless demo LLM_PROVIDER=demo STT_PROVIDER=mock TTS_PROVIDER=mock
pnpm db:migrate
pnpm db:seed          # demo restaurant "Pizzeria Bella Vista"
pnpm dev              # web http://localhost:3000 · voice server http://localhost:8080
```

With `pnpm dev` the secrets in `.env` can stay empty: in development the web app and the voice server
share a built-in (insecure) fallback. Production, including the Docker images, requires them.

Open <http://localhost:3000> → create the admin account → Restaurants → _Pizzeria Bella Vista_ →
**Test call**. Add an `OPENAI_API_KEY` (and `LLM_PROVIDER=openai`) to talk to the real assistant
(default model `gpt-5.4-mini`; see [SETUP](docs/SETUP.md#2-openai--the-language-model) for the
alternatives).

Everything with Docker instead: the images run in production mode, so set `BETTER_AUTH_SECRET` and
`INTERNAL_API_SECRET` (`openssl rand -base64 32` each) and `POSTGRES_PASSWORD` (letters and digits) in
`.env`, then `docker compose up -d --build` and, for the demo restaurant,
`docker compose run --rm migrate pnpm --filter @justcall/db seed`.

## Going live

1. [docs/SETUP.md](docs/SETUP.md) – create the accounts (Supabase, OpenAI, Twilio, AWS, email) and fill
   in the environment variables. Start the slow approvals first: Twilio Business profile and Swiss
   number bundle, AWS quota increases.
2. [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) – deploy (Vercel Pro + Render/Fly.io, or your own server).
   Monthly invoices run inside the voice server; there is no Vercel cron.
3. `pnpm doctor` – verifies every integration.
4. Admin → _Settings_ (company address, IBAN) and _Guides_ – onboard the first restaurant.

## Documentation

| Document                                           | Contents                                                               |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| [SETUP](docs/SETUP.md)                             | External services step by step, model choice, keys, variable reference |
| [DEPLOYMENT](docs/DEPLOYMENT.md)                   | Hosting options, scaling, upgrades                                     |
| [ARCHITECTURE](docs/ARCHITECTURE.md)               | Components, call flow, data model, security, extending                 |
| [CONVERSATION_DESIGN](docs/CONVERSATION_DESIGN.md) | Call flow, safety rules, prompts, tools                                |
| [OPERATIONS](docs/OPERATIONS.md)                   | Daily use, billing, capacity, costs, monitoring, privacy, support      |

## Repository

```
apps/web          Next.js admin console + restaurant portal
apps/voice        Voice server (Twilio media streams, STT/TTS, jobs)
packages/core     Domain logic & conversation engine (pure TypeScript, fully tested)
packages/db       Drizzle schema, migrations, repositories
packages/services Twilio, email, SMS text, invoice PDFs
```

## Scripts

| Command                                                                    |                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`                                                                 | Web + voice server with hot reload                                              |
| `pnpm test`                                                                | Unit and integration tests (voice tests need a Postgres at `TEST_DATABASE_URL`) |
| `pnpm typecheck` / `pnpm lint`                                             | Types / formatting                                                              |
| `pnpm build`                                                               | Production builds                                                               |
| `pnpm db:migrate` / `db:generate` / `db:seed` / `db:studio`                | Database                                                                        |
| `pnpm doctor`                                                              | Check all external integrations                                                 |
| `pnpm eval`                                                                | Scripted Swiss German conversations against the configured model                |
| `pnpm --filter @justcall/voice chat -- <slug>`                             | Talk to a restaurant's assistant in the terminal                                |
| `pnpm admin:create --email you@example.ch`                                 | Create/promote an administrator                                                 |
| `pnpm --filter @justcall/web e2e`                                          | Playwright end-to-end test (servers must run)                                   |
| `pnpm --filter @justcall/web exec playwright install --with-deps chromium` | Install the browser for the e2e test once (or set `PW_CHROMIUM_PATH`)           |

## License

Proprietary – © JustCall. All rights reserved.
