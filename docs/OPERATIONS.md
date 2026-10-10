# Operations

## Daily use

| Who                  | Where              | What                                                                                              |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------------- |
| JustCall admin (you) | `/admin`           | Restaurants, menus, numbers, calls & transcripts, orders, invoices, system status                 |
| Restaurant owner     | `/r/<slug>/…`      | Orders board, sold-out toggles, bot pause, rush-hour waiting time, opening hours, calls, invoices |
| Restaurant staff     | `/r/<slug>/orders` | Orders board on a tablet at the counter (keep the tab open, tap _Ton aktivieren_ once)            |

### Rush hour

The restaurant taps **+10 / +20 / +30** on the orders board – the assistant immediately quotes later
pickup times. **Assistent pausiert** forwards new calls directly to the transfer number.

### Sold out

Staff mark items or options as _Ausverkauft_ in the portal; the assistant stops offering them within
seconds and suggests alternatives.

## Monthly billing

1. On the 1st of every month at 06:00 (Europe/Zurich) the voice server creates **draft invoices** for
   the previous month for every active/paused restaurant: commission × order volume (excluding test,
   cancelled and excluded orders) + monthly fee + per-order fee, plus VAT if configured. If the server
   was down at that time, it catches up 30 s after the next start.
2. Review drafts in **Invoices** (PDF preview with Swiss QR-bill), then **Send by email**. Set
   `INVOICE_AUTO_SEND=true` on the voice server to send them automatically.
3. Mark invoices as **paid** when the money arrives (or **void** + regenerate to correct one).
4. Disputed orders can be excluded from billing on the order page (_Exclude from billing_).

The job is idempotent and protected by a database lock, so it runs exactly once even with several voice
server instances. It needs `JOBS_ENABLED=true` (the default) on the voice server. There is no Vercel
cron: the voice job is the only scheduler. `GET /api/cron/monthly-invoices` on the web app (header
`Authorization: Bearer $CRON_SECRET`) is only for setups with `JOBS_ENABLED=false` and an external
scheduler. It only creates drafts and never sends them, whatever `INVOICE_AUTO_SEND` says.
`JOBS_ENABLED=false` also stops the daily maintenance (transcript deletion, stale-call cleanup), so
keep the voice job on unless you replace both.

## Capacity planning (50+ parallel calls)

Each live call holds: 1 Twilio media stream, 1 streaming STT session, LLM requests (~1 per caller
sentence), TTS requests (~1 per assistant sentence). JustCall's own server is not the bottleneck
(integration test: 20 simultaneous calls to one restaurant with gap-free order numbers); the provider
limits are:

| Provider       | Limit to check                                                                                                                | Recommended for 50 parallel calls                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Twilio         | 2 concurrent calls without an approved Business Primary Customer Profile (accounts upgraded since 3 Feb 2026); a transfer = 2 | **Approved Business profile** (Trust Hub): unlimited concurrency, no rate limit on inbound or transfers |
| AWS Transcribe | _Number of concurrent streams (HTTP/2 + Websocket)_: default 25 per region                                                    | **Request 100** in Service Quotas in the `AWS_REGION` region; ramp load tests up gradually              |
| AWS Polly      | _Default rate of SynthesizeSpeech (generative) requests_: default 8 per second per region                                     | **Request ~20 per second** (neural has the same default of 8); or Azure/ElevenLabs                      |
| OpenAI         | Usage tier: Build allows 5,000 requests and 2M tokens per minute, USD 500 per month                                           | **Launch** (≥ USD 100 credits bought): 10,000 RPM, 10M TPM, USD 5,000 per month                         |
| Azure Speech   | Free tier F0: 1 concurrent recognition                                                                                        | Standard **S0**: 100 concurrent recognitions by default                                                 |
| ElevenLabs     | Concurrent requests per plan (Starter 6, Creator 10, Pro 20)                                                                  | Creator or Pro (a slot is held only while audio is generated)                                           |
| Database       | Supabase session pooler _Pool Size_                                                                                           | `DATABASE_POOL_MAX` (10) × voice instances + migrations below Pool Size                                 |

An OpenAI hard spend limit set too low stops every call once it is reached (HTTP 429); use spend alerts
and keep any hard limit well above the expected monthly spend.

Run 2 voice server instances for redundancy; both handle calls independently (count both against the
database Pool Size).

## Costs

Rough estimate from the vendors' list prices (October 2026; USD converted at USD 1 ≈ CHF 0.80). Check
the current price lists before quoting customers.

| Item                                                       | List price (USD)               | ≈ CHF                      |
| ---------------------------------------------------------- | ------------------------------ | -------------------------- |
| Twilio incoming call on a Swiss local number               | 0.01 per minute                | 0.008 per minute           |
| Twilio Media Streams                                       | 0.0044 per minute              | 0.0035 per minute          |
| AWS Transcribe streaming (de-CH), billed per second        | 0.01 per minute                | 0.008 per minute           |
| Polly generative voice (~350 characters per minute)        | 30 per million characters      | 0.008 per minute           |
| LLM (gpt-5.4-mini, with prompt caching)                    | 0.75 / 4.50 per million tokens | 0.005–0.02 per minute      |
| **Per minute of AI call**                                  |                                | **≈ 0.03–0.05 per minute** |
| Order confirmation SMS (CH), 1–3 segments                  | 0.0769 per segment             | 0.06–0.18 per order        |
| Transfer to a Swiss mobile (extra leg, on top of the call) | 0.18 per minute                | 0.14 per minute            |
| Transfer to a Swiss landline (extra leg)                   | 0.042 per minute               | 0.034 per minute           |
| Twilio Swiss local number                                  | 1.15 per month                 | 0.92 per number and month  |

A typical order call takes 1.5–3 minutes, so the call itself costs **≈ CHF 0.05–0.15** and, with the
SMS, **≈ CHF 0.11–0.33 per order**. The SMS is often the largest single item. Transfers are expensive:
one minute to the owner's mobile costs about as much as three to four minutes of AI call. With a 5 %
commission on an average order of CHF 40 (CHF 2.00) the margin is still healthy. The call detail page
shows tokens, recognised audio seconds and spoken characters per call for exact accounting.

Fixed monthly costs come on top: Supabase Pro (from USD 25), Vercel Pro (USD 20 per member plus usage),
the Render or Fly.io voice server, Resend Pro (USD 20) and one Twilio number per restaurant.

## Monitoring

- **Admin → System status**: database, voice server, Twilio, SMTP, model configuration, secrets.
- **Health endpoints**: `GET /api/health` (web), `GET /health` and `GET /ready` (voice) – use them
  for uptime monitoring (e.g. Better Stack, UptimeRobot) and alert by SMS.
- **Logs**: the voice server logs JSON (pino) – every call has a `callId`. Ship them to Render/Fly logs,
  Better Stack or Grafana Loki.
- **Calls with outcome `error`** or many _transferred · other_ calls point to provider issues – check the
  transcript's system events (`STT-Fehler`, `TTS-Fehler`, `Modellfehler`).
- `pnpm doctor` on the voice server performs real requests against every provider.

## Privacy (Swiss revDSG / GDPR)

- Data stored: caller number, name, order, transcript text (no audio recordings).
- Transcripts are deleted automatically after `TRANSCRIPT_RETENTION_DAYS` (default 180); orders and
  invoices are kept for bookkeeping (10 years in Switzerland).
- The greeting states that callers talk to a digital assistant; the assistant confirms it is an AI when
  asked.
- Choose EU/CH regions: Supabase Zurich/Frankfurt, AWS eu-central-1/2, Azure Switzerland North,
  hosting in Frankfurt. OpenAI offers EU data residency for API projects. Twilio processes calls,
  webhooks and media streams in its US1 region by default (`TWILIO_EDGE` only changes the REST API
  host); processing in Ireland (IE1) would need a code change. Resend keeps account data in the US
  whatever sending region you choose.
- Sign data processing agreements (DPA/AVV) with all providers and list them in your privacy policy.
- Add a privacy notice to the restaurant contract (the restaurant is the controller of its customer data,
  JustCall the processor).

## Backups & recovery

- Supabase Pro: automatic daily backups, kept 7 days. Point-in-time recovery is a paid add-on that
  replaces the daily backups. The Free plan has no backups. Self-hosted: nightly `pg_dump`, keep 30
  days off-site.
- Everything else is stateless – redeploy from GitHub.
- If the voice server is down or does not answer, Twilio automatically calls the **fallback URL**
  `APP_URL/api/twilio/fallback` (set on every number JustCall connects, requires an `https://`
  `APP_URL`). The web app – hosted separately – forwards the caller straight to the restaurant's transfer
  number and records the incident as a call with outcome _error_. No call is lost.
- Deploys: running calls get up to 290 s to finish (`DRAIN_TIMEOUT_SECONDS`); longer calls are cut, so
  deploy outside opening hours when you can.

## Support playbook

| Symptom                                       | Check                                                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| "Diese Nummer ist zurzeit nicht in Betrieb"   | Number connected to the restaurant? Restaurant status _active_ (not draft/archived)?                                                      |
| Calls ring but no answer / immediate hang-up  | `VOICE_PUBLIC_URL` correct and HTTPS? Twilio account upgraded (trial strips the AI stream)? Twilio debugger (Console → Monitor → Errors)  |
| Third simultaneous caller fails (error 10004) | Twilio Business Primary Customer Profile approved? Without it the account allows 2 concurrent calls.                                      |
| Assistant misunderstands an item              | Add aliases; test with the menu's matching box; check transcripts for how callers say it                                                  |
| Long pauses                                   | Faster model (`gpt-5.4-mini`, `gpt-6-luna`) with `OPENAI_REASONING_EFFORT=none`, `END_OF_TURN_MS` 500–700, check provider latency in logs |
| Restaurant never completes an order           | Per-restaurant model `gpt-6-astra` or `gpt-6.1-sol`? They can't call tools in Chat Completions – clear the override.                      |
| `STT-Fehler` / `TTS-Fehler` at peak times     | AWS quotas (Transcribe streams, Polly rate) in `AWS_REGION`; `LimitExceededException` during load tests means ramp up more slowly         |
| No SMS                                        | Caller on a mobile (no SMS to landlines)? Alphanumeric Sender ID enabled? Geo permissions for CH SMS? Sender name ≤ 11 chars, no umlauts? |
| Transfer fails                                | Transfer number differs from forwarded number? Twilio voice geo permissions?                                                              |
| No invoices                                   | Platform settings (IBAN, address)? Restaurant status active? `JOBS_ENABLED=true` on the voice server?                                     |
