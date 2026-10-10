# Setup guide – connecting the external services

This guide lists every external service JustCall uses: what it is for, how to create the account and
which values go into the environment variables (see [`.env.example`](../.env.example)). Do the steps
in this order; the slow ones (Twilio's Swiss number approval, AWS quota increases) are marked ⏳ so you
can start them first.

| #   | Service                                                                   | Used for                                                                  | Required?         | Env vars                                                     |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------ |
| 1   | **PostgreSQL** (Supabase)                                                 | All data                                                                  | ✅                | `DATABASE_URL`                                               |
| 2   | **OpenAI**                                                                | The assistant's brain (LLM), AI menu import, optional STT/TTS for testing | ✅ (or Anthropic) | `OPENAI_API_KEY`, `OPENAI_MODEL`                             |
| 3   | **Twilio** ⏳                                                             | Swiss phone numbers, receiving calls, transfers, confirmation SMS         | ✅ for real calls | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` |
| 4   | **AWS** (Transcribe + Polly) ⏳                                           | Swiss German speech recognition (`de-CH`) and Swiss voice "Sabrina"       | ✅ recommended    | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`   |
| 5   | Azure AI Speech                                                           | Alternative `de-CH` recognition + Swiss voices (Leni, Jan)                | optional          | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`                    |
| 6   | ElevenLabs                                                                | Premium / cloned Swiss German voice                                       | optional          | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`                  |
| 7   | **Email (SMTP)**, e.g. Resend                                             | Invoices, invitations, password resets                                    | ✅ for production | `SMTP_*`, `EMAIL_FROM`                                       |
| 8   | **Hosting** – Vercel (web) + Render or Fly.io (voice), or your own server | Running the app 24/7                                                      | ✅ for production | `APP_URL`, `VOICE_PUBLIC_URL`                                |
| 9   | Anthropic                                                                 | Alternative LLM (Claude)                                                  | optional          | `ANTHROPIC_API_KEY`                                          |

> **Minimum to try everything locally:** a database and nothing else. Without API keys the app runs
> with a rule-based demo assistant and mock speech (`LLM_PROVIDER=demo`, `STT_PROVIDER=mock`,
> `TTS_PROVIDER=mock`). Add an OpenAI key to test real conversations in the browser simulator.

---

## 1. Database – Supabase (already created)

JustCall only needs a PostgreSQL database. Supabase works well; any other PostgreSQL 15+ (Neon, AWS
RDS, your own server) works the same way – nothing is Supabase-specific.

1. Supabase dashboard → your project → **Connect** (top bar) → **Session pooler**.
2. Copy the URI. It looks like
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`
3. Replace `[YOUR-PASSWORD]` with the database password. **URL-encode special characters**: `@` → `%40`,
   `#` → `%23`, `/` → `%2F`, `:` → `%3A`, `?` → `%3F`, `%` → `%25`.
4. Set it as `DATABASE_URL`.

Why the _Session pooler_: the "Direct connection" host (`db.<ref>.supabase.co`) is IPv6-only and
does not work from Vercel, Render or most Docker hosts. For serverless functions you may also use the
_Transaction pooler_ (port 6543) – JustCall detects it and disables prepared statements.

> ⚠️ **About the current cloud environment:** the `DATABASE_URL` set there uses the direct
> `db.<ref>.supabase.co` host and contains an unencoded `@` in the password – switch it to the Session
> pooler string with `%40`. The `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and anon key are **not
> needed** (JustCall talks to Postgres directly); you can delete them. If you ever shared the database
> password, rotate it under Project Settings → Database.

Apply the schema (creates all tables, locks down Supabase's public REST API with row level security):

```bash
pnpm db:migrate
pnpm db:seed        # optional: demo restaurant "Pizzeria Bella Vista" with a full menu
```

Tip: choose the Supabase region **Zurich (eu-central-2)** or **Frankfurt (eu-central-1)** for low
latency and Swiss/EU data residency. Enable daily backups (Pro plan) before going live.

## 2. OpenAI – the language model

1. <https://platform.openai.com> → **API keys** → _Create new secret key_ (project-scoped).
2. **Billing → Limits**: set a monthly budget and an email alert.
3. Set:
   ```
   LLM_PROVIDER=openai
   OPENAI_API_KEY=sk-proj-…
   OPENAI_MODEL=gpt-5.4-mini
   OPENAI_REASONING_EFFORT=none
   ```

**Choosing the model** – on the phone, speed matters as much as intelligence (callers notice pauses
above ~1.5 s). The assistant never computes prices or invents menu items (the server does that), so
a fast "mini" model is enough:

| Model                    | When to use                                                       |
| ------------------------ | ----------------------------------------------------------------- |
| `gpt-5.4-mini` (default) | Best balance of speed, cost and tool calling. Start here.         |
| `gpt-5.4-nano`           | Cheapest; try it once the menus are well aliased.                 |
| `gpt-4.1-mini`           | Fast non-reasoning fallback if a newer model behaves differently. |
| `gpt-5.4` / `gpt-5.5`    | Smartest, slower – for complex menus or many dialects.            |

Compare models objectively with the evaluation harness – it runs nine scripted Swiss German calls
(ordering, aliases, allergy transfer, owner request, delivery, changes, prompt injection) and prints the
pass rate and the time to the first spoken sentence:

```bash
OPENAI_MODEL=gpt-5.4-mini pnpm eval
OPENAI_MODEL=gpt-5.4-nano pnpm eval
```

The model can also be overridden per restaurant (Restaurant → Settings → Voice assistant). To use
Claude instead: `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-haiku-5-5`.

> ⚠️ The `OPENAI_API_KEY` currently set in the cloud environment is the placeholder `sk-...`. Replace
> it with a real key (see "Giving keys to a Claude Code cloud session" below).

## 3. Twilio – phone numbers, calls and SMS ⏳

1. Sign up at <https://www.twilio.com>, verify your email/phone, **upgrade the account** (trial
   accounts play a trial message and can only call verified numbers).
2. **Regulatory bundle for Switzerland** ⏳ – Console → Phone Numbers → _Regulatory Compliance_ →
   _Bundles_ → _Create_ → Switzerland, number type _Local_ (and/or _National_), end-user type
   _Business_. You need a Swiss business address and a company document (Handelsregisterauszug or
   similar). Approval usually takes 1–3 business days. Note the **Bundle SID** (`BU…`) and the
   **Address SID** (`AD…`) → `TWILIO_CH_BUNDLE_SID`, `TWILIO_CH_ADDRESS_SID` (lets you buy numbers from
   the JustCall admin).
3. **Buy a number** per restaurant (e.g. a 044 number for Zürich) – in the Twilio console or later in
   JustCall → Phone numbers → _Buy a Swiss number_.
4. **Credentials**: Console → Account → _API keys & tokens_ → **Account SID** (`AC…`) and **Auth
   Token** → `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.
5. **Geo permissions** (Console → Voice → Settings → Geo permissions, and Messaging → Settings → Geo
   permissions): enable **Switzerland** (transfers to the owner's mobile and SMS to callers).
6. **SMS sender**: Switzerland supports alphanumeric sender IDs. Set `TWILIO_SMS_FROM=JustCall` (max. 11
   characters); each restaurant can override it with its own name (e.g. `BellaVista`). Alternatively
   use a Messaging Service SID (`MG…`) or an SMS-capable Twilio number.
7. Keep `TWILIO_EDGE=frankfurt` (audio is processed close to Switzerland).

You do **not** need to configure webhooks by hand: when you connect a number to a restaurant in JustCall
(Restaurant → Phone), the voice webhook and status callback are set automatically to
`VOICE_PUBLIC_URL/twilio/voice` and `/twilio/status`.

**How restaurants connect their existing number:** they keep their number and forward calls to the
JustCall number. The Phone tab shows the GSM codes for _overflow_ forwarding (only when busy / not
answered – ideal for rush hours) or _always_. The **transfer number** (owner's mobile) must be a
different number, otherwise transferred calls would loop back.

## 4. AWS – Swiss German speech recognition and voice ⏳

Amazon Transcribe supports streaming recognition of **Swiss German (`de-CH`)** and Amazon Polly has a
Swiss voice (**Sabrina**, generative engine). One AWS account covers both.

1. Create an AWS account (<https://aws.amazon.com>), enable MFA on the root user.
2. IAM → _Policies_ → _Create policy_ → JSON:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "transcribe:StartStreamTranscription",
           "transcribe:StartStreamTranscriptionWebSocket",
           "polly:SynthesizeSpeech",
           "polly:DescribeVoices"
         ],
         "Resource": "*"
       }
     ]
   }
   ```
   Name it `justcall-speech`.
3. IAM → _Users_ → _Create user_ `justcall-voice` → attach `justcall-speech` → _Security credentials_ →
   _Create access key_ (use case: application running outside AWS).
4. Set:
   ```
   STT_PROVIDER=aws
   TTS_PROVIDER=polly
   AWS_REGION=eu-central-1
   AWS_ACCESS_KEY_ID=AKIA…
   AWS_SECRET_ACCESS_KEY=…
   TRANSCRIBE_LANGUAGE=de-CH
   POLLY_VOICE=Sabrina
   POLLY_ENGINE=generative
   ```
5. **Quotas** ⏳ – Service Quotas → Amazon Transcribe → _Concurrent streaming transcription_ /
   _StartStreamTranscription concurrent streams_ in `eu-central-1`. Request at least **100** (each live
   call uses one stream; plan for all restaurants' peak at once). For Polly generative voices check the
   _transactions per second_ quota as well (every spoken sentence is one request; a busy evening with
   50 parallel calls needs roughly 10–20 TPS).
6. Listen to the voice: Polly console → _Text-to-speech_ → Engine _Generative_, Language _German
   (Switzerland)_ – or use _Preview greeting_ in JustCall (Restaurant → Settings).

**Alternatives** (switch per restaurant or globally, no code change):

- **Azure AI Speech** – also strong for Swiss German (`de-CH`) with natural Swiss voices
  (`de-CH-LeniNeural`, `de-CH-JanNeural`). Azure portal → _Speech service_ → region **Switzerland North**
  → _Keys and Endpoint_ → `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION=switzerlandnorth`; then
  `STT_PROVIDER=azure` and/or `TTS_PROVIDER=azure`. Recommended to A/B test against AWS with real
  callers – Swiss German recognition quality differs by region and dialect.
- **ElevenLabs** – most natural voices; you can pick or clone a Swiss German voice. Create an API key,
  copy the voice ID → `TTS_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`.
- **OpenAI speech** – `STT_PROVIDER=openai`, `TTS_PROVIDER=openai` work with only an OpenAI key. Good for
  a first end-to-end test; the voice has a German (not Swiss) accent.
- **Spitch** (Swiss Swiss-German ASR specialist, suggested by your professors) has no public
  self-service API documented as of this build. The speech layer is pluggable
  (`apps/voice/src/stt/`): once you have API access, an adapter is ~80 lines following `azure.ts`.
- **Amazon Nova Sonic / OpenAI Realtime** (speech-to-speech) support German but not Swiss German
  specifically, and do not allow the deterministic safety checks JustCall runs on every transcript –
  therefore not used for ordering.

## 5. Email – invoices, invitations, password resets

Any SMTP provider works. Example with **Resend**:

1. <https://resend.com> → _Domains_ → add your domain (e.g. `justcall.ch`) → add the DNS records shown.
2. _API keys_ → create a key with _Sending access_.
3. Set:
   ```
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=465
   SMTP_USER=resend
   SMTP_PASSWORD=re_…
   EMAIL_FROM=JustCall <billing@justcall.ch>
   ```

Swiss alternative with data in Switzerland: Infomaniak mail (`mail.infomaniak.com`, port 465).
Without SMTP, emails are written to the server log (invitation links are also shown in the UI).

## 6. Secrets

Generate three random secrets (each at least 32 characters) and set them on **both** the web app and
the voice server:

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET
openssl rand -base64 32   # INTERNAL_API_SECRET  (must be identical on web + voice)
openssl rand -base64 32   # CRON_SECRET
```

## 7. Hosting

See [DEPLOYMENT.md](DEPLOYMENT.md). Recommended: **Vercel** (web app, region Frankfurt) + **Render**
or **Fly.io** (voice server, Frankfurt) + Supabase. Point two domains at them, e.g.
`app.justcall.ch` → web and `voice.justcall.ch` → voice server, and set
`APP_URL=https://app.justcall.ch`, `VOICE_PUBLIC_URL=https://voice.justcall.ch`.

## 8. First start

```bash
pnpm install
cp .env.example .env      # fill in
pnpm db:migrate
pnpm dev                  # web on :3000, voice server on :8080
pnpm doctor               # checks every integration with a real request
```

Open the web app → `/setup` creates the first administrator (only possible while no user exists;
alternatively `pnpm admin:create --email you@example.ch`). Then follow _Guides_ in the admin console:
create restaurant → menu → hours → transfer number → test call → connect number → invite the
restaurant → activate.

For real phone calls during local development, expose the voice server with a tunnel
(`cloudflared tunnel --url http://localhost:8080` or `ngrok http 8080`) and set `VOICE_PUBLIC_URL` to
the HTTPS tunnel URL before connecting a number.

## Giving keys to a Claude Code cloud session

Environment variables of a cloud session come from its **environment** settings in Claude Code on the
web (environment → _Environment variables_). Edit them there in `.env` format (one `KEY=value` per
line) and **start a new session** – running sessions keep the values they started with. Never paste
secrets into the chat. A new session can then run `pnpm doctor` and `pnpm eval` against the real
services.
