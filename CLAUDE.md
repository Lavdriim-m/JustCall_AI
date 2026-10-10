# CLAUDE.md – guide for AI coding sessions

JustCall: AI phone ordering for Swiss restaurants. pnpm monorepo, TypeScript strict, Node 22.

## Layout

- `packages/core` – pure domain logic (no I/O): `menu/menu-index.ts` (alias matching), `cart.ts`
  (pricing), `hours.ts`, `safety.ts` (allergy/owner guards), `speech.ts`, `invoice.ts`,
  `conversation/{engine,prompts,tools}.ts`, `llm/*` (OpenAI, Anthropic, demo), `eval/*`.
- `packages/db` – Drizzle schema (`src/schema.ts`), SQL migrations (`drizzle/`), repositories (`src/repo`).
- `packages/services` – Twilio, SMTP, SMS text, invoice PDF (Swiss QR-bill).
- `apps/voice` – Fastify voice server: `routes/twilio.ts` (webhooks + media stream), `routes/simulator.ts`,
  `call/session.ts` (STT ↔ engine ↔ TTS, barge-in, transfers), `stt/*`, `tts/*`, `jobs/scheduler.ts`.
- `apps/web` – Next.js 16 App Router. Server actions in `src/server/actions/*`, access control in
  `src/server/session.ts`, admin pages `src/app/admin`, restaurant portal `src/app/r/[slug]`.

## Commands

- `pnpm test` – all tests (voice integration tests need Postgres: `TEST_DATABASE_URL`, default
  `postgres://postgres@localhost:5433/justcall_test`).
- `pnpm typecheck`, `pnpm lint` (prettier), `pnpm format`.
- `pnpm dev` – web :3000 + voice :8080 (reads root `.env`).
- `pnpm db:generate` after schema changes (commit the generated SQL), `pnpm db:migrate`.
- `pnpm eval` – conversation evals against the configured LLM.
- E2E: start servers with `LLM_PROVIDER=demo STT_PROVIDER=mock TTS_PROVIDER=mock`, seeded DB, then
  `pnpm --filter @justcall/web e2e`. Install the browser once first (CI does the same):
  `pnpm --filter @justcall/web exec playwright install --with-deps chromium`, or set
  `PW_CHROMIUM_PATH` to an installed Chromium. Optional: `E2E_BASE_URL`, `E2E_EMAIL`,
  `E2E_PASSWORD`, `E2E_SCREENSHOTS`.

## Conventions

- Money = integer Rappen (cents), percentages = basis points. Never compute prices in prompts.
- Business rules belong in `packages/core` with unit tests; the LLM only chooses tools.
- Safety rules (allergy → transfer, review before confirm) are enforced in code – keep them that way.
- Prompts are German (Swiss spelling, no "ß"); UI: admin English, restaurant portal German.
- Every server action validates input with zod and checks access via `requireAdmin` /
  `requireRestaurantAccess`; call `invalidateVoiceCache` after restaurant/menu changes.
- Runtime env vars are documented in `.env.example` and in the "Environment variable reference" table
  at the end of `docs/SETUP.md` (service, code default, purpose) – add new ones to both. Variables set
  by the platform or used only by tests/tooling (`NODE_ENV`, `NEXT_*`, `TEST_DATABASE_URL`, `E2E_*`,
  `PW_CHROMIUM_PATH`) go only in the SETUP table.
- In the cloud sandbox, unset the preset `DATABASE_URL`/`OPENAI_API_KEY`/`LLM_PROVIDER` when running
  locally (`env -u …`) because Node's `--env-file` does not override existing variables.
