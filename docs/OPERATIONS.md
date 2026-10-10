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
   the previous month for every active/paused restaurant:
   commission × order volume (excluding test, cancelled and excluded orders) + monthly fee + per-order fee
   - VAT (if configured).
2. Review drafts in **Invoices** (PDF preview with Swiss QR-bill), then **Send by email**. Set
   `INVOICE_AUTO_SEND=true` to send automatically.
3. Mark invoices as **paid** when the money arrives (or **void** + regenerate to correct one).
4. Disputed orders can be excluded from billing on the order page (_Exclude from billing_).

The job is idempotent and protected by a database lock, so it runs exactly once even with several voice
server instances or the additional Vercel cron (`/api/cron/monthly-invoices`).

## Capacity planning (50+ parallel calls)

Each live call holds: 1 Twilio media stream, 1 streaming STT session, LLM requests (~1 per caller
sentence), TTS requests (~1 per assistant sentence). JustCall's own server is not the bottleneck
(integration test: 20 simultaneous calls to one restaurant with gap-free order numbers); the provider
limits are:

| Provider       | Limit to check                                                       | Recommended for 50 parallel calls                           |
| -------------- | -------------------------------------------------------------------- | ----------------------------------------------------------- |
| Twilio         | inbound calls are not rate limited; outbound transfers 1 CPS default | fine; request higher CPS if many transfers                  |
| AWS Transcribe | concurrent streaming sessions per region (default ~25)               | **request ≥ 100** in Service Quotas                         |
| AWS Polly      | TPS for the generative engine                                        | request increase to ~20 TPS; or Azure/ElevenLabs            |
| OpenAI         | tokens/requests per minute of your usage tier                        | tier 2+ (prepaid ≥ USD 50) is plenty                        |
| Database       | connections                                                          | `DATABASE_POOL_MAX=10` per instance with the session pooler |

Run 2 voice server instances for redundancy; both handle calls independently.

## Costs (rough estimate per minute of call, verify current price lists)

| Item                                             | ~ per minute                         |
| ------------------------------------------------ | ------------------------------------ |
| Twilio inbound Swiss local number + media stream | CHF 0.01–0.02                        |
| Twilio number rental                             | ~ CHF 1–3 per number and month       |
| AWS Transcribe streaming (de-CH)                 | ~ CHF 0.02                           |
| Polly generative voice (~350 characters/min)     | ~ CHF 0.01                           |
| LLM (gpt-5.4-mini, with prompt caching)          | ~ CHF 0.005–0.02                     |
| SMS (CH)                                         | ~ CHF 0.05–0.08 per order            |
| **Total**                                        | **≈ CHF 0.05–0.08 per minute + SMS** |

A typical order call takes 1.5–3 minutes → **≈ CHF 0.15–0.30 per order**. With a 5 % commission on an
average order of CHF 40 (CHF 2.00) the margin is healthy. The call detail page shows tokens, recognised
audio seconds and spoken characters per call for exact accounting.

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
- Choose EU/CH regions: Supabase Zurich/Frankfurt, AWS eu-central-1/2, Azure Switzerland North, Twilio
  edge Frankfurt, hosting in Frankfurt. OpenAI offers EU data residency for API projects.
- Sign data processing agreements (DPA/AVV) with all providers and list them in your privacy policy.
- Add a privacy notice to the restaurant contract (the restaurant is the controller of its customer data,
  JustCall the processor).

## Backups & recovery

- Supabase Pro: daily backups + point-in-time recovery. Self-hosted: nightly `pg_dump`, keep 30 days
  off-site.
- Everything else is stateless – redeploy from GitHub.
- If the voice server is down, Twilio returns an error to callers. Configure a **fallback URL** on each
  Twilio number (Console → number → _Primary handler fails_) with TwiML that dials the restaurant, e.g. a
  TwiML Bin:
  ```xml
  <Response><Dial>+41791112233</Dial></Response>
  ```

## Support playbook

| Symptom                                      | Check                                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| "Diese Nummer ist zurzeit nicht in Betrieb"  | Number connected to the restaurant? Restaurant status _active_ (not draft/archived)?                  |
| Calls ring but no answer / immediate hang-up | `VOICE_PUBLIC_URL` correct and HTTPS? Twilio debugger (Console → Monitor → Errors)                    |
| Assistant misunderstands an item             | Add aliases; test with the menu's matching box; check transcripts for how callers say it              |
| Long pauses                                  | Faster model (`gpt-5.4-mini`/`nano`), `END_OF_TURN_MS` 500–700, check provider latency in logs        |
| No SMS                                       | Caller ID mobile? Twilio geo permissions for CH SMS? Sender name valid (≤ 11 chars, no umlauts)?      |
| Transfer fails                               | Transfer number differs from forwarded number? Twilio voice geo permissions?                          |
| No invoices                                  | Platform settings (IBAN, address)? Restaurant status active? `JOBS_ENABLED=true` on the voice server? |
