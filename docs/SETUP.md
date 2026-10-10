# Setup guide – connecting the external services

This guide lists every external service JustCall uses: what it is for, how to create the account and
which values go into the environment variables. Every variable is listed in the
[environment variable reference](#environment-variable-reference) at the end; the runtime ones are
also in [`.env.example`](../.env.example). Do the steps in this order. The slow ones are marked ⏳ so you can
start them first: Twilio's Business profile and Swiss number bundle, and the AWS quota increases.

Vendor facts (menu paths, quotas, prices) were checked against the vendors' documentation in
October 2026. They change often, so trust the vendor's page when it differs from this guide.

| #   | Service                                                                  | Used for                                                                  | Required?                                       | Env vars                                                     |
| --- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------ |
| 1   | **PostgreSQL** (Supabase)                                                | All data                                                                  | ✅                                              | `DATABASE_URL`                                               |
| 2   | **OpenAI**                                                               | The assistant's brain (LLM), AI menu import, optional STT/TTS for testing | ✅ (calls can use Anthropic; menu import can't) | `OPENAI_API_KEY`, `OPENAI_MODEL`                             |
| 3   | **Twilio** ⏳                                                            | Swiss phone numbers, receiving calls, transfers, confirmation SMS         | ✅ for real calls                               | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` |
| 4   | **AWS** (Transcribe + Polly) ⏳                                          | Swiss German speech recognition (`de-CH`) and Swiss voice "Sabrina"       | ✅ recommended                                  | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`   |
| 5   | Azure AI Speech                                                          | Alternative `de-CH` recognition + Swiss voices (Leni, Jan)                | optional                                        | `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION`                    |
| 6   | ElevenLabs                                                               | Swiss-accented or cloned voice (Standard German)                          | optional                                        | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`                  |
| 7   | **Email (SMTP)**, e.g. Resend                                            | Invoices, invitations, password resets, order emails                      | ✅ for production                               | `SMTP_*`, `EMAIL_FROM`                                       |
| 8   | **Hosting**: Vercel (web) + Render or Fly.io (voice), or your own server | Running the app 24/7                                                      | ✅ for production                               | `APP_URL`, `VOICE_PUBLIC_URL`                                |
| 9   | Anthropic                                                                | Alternative LLM (Claude) for calls                                        | optional                                        | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`                       |

> **Minimum to try everything locally:** a PostgreSQL database. In `.env` set `DATABASE_URL` and, for
> a keyless demo, `LLM_PROVIDER=demo`, `STT_PROVIDER=mock` and `TTS_PROVIDER=mock` (the defaults
> `openai`, `aws` and `polly` need keys). The secrets can stay empty: outside production the web app
> and the voice server fall back to the same built-in development secret. Add an OpenAI key and
> `LLM_PROVIDER=openai` to test real conversations in the browser simulator. The simulator falls back
> to the demo assistant when the key is missing; real phone calls do not.

---

## 1. Database – Supabase

JustCall only needs a PostgreSQL 15+ database. Supabase works well; Neon, AWS RDS or your own server
work the same way, because nothing is Supabase-specific.

1. Create a project in region **Zurich (eu-central-2)** or **Frankfurt (eu-central-1)** for low
   latency and Swiss/EU data residency. Keep the database password.
2. Project → **Connect** (top of the page) → **Session pooler**. Copy the URI exactly as shown. It
   looks like
   `postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-<index>-<region>.pooler.supabase.com:5432/postgres`.
   Don't build the host from your region: the `aws-0-` / `aws-1-` prefix is a pooler cluster number
   that differs between projects, and a wrong one does not connect.
3. Replace `[YOUR-PASSWORD]` with the database password, **percent-encoded**: `@` → `%40`, `#` → `%23`,
   `/` → `%2F`, `:` → `%3A`, `?` → `%3F`, `&` → `%26`, `%` → `%25`, space → `%20`.
4. Set it as `DATABASE_URL`.

Why the _Session pooler_: the direct host (`db.<ref>.supabase.co`) is IPv6-only unless you buy the
IPv4 add-on, and hosts such as Vercel and Render only connect over IPv4. Both poolers use IPv4.
Serverless hosts (Vercel) use the **Transaction pooler** (port 6543) with `DATABASE_POOL_MAX=1` to `3`;
JustCall detects port 6543 and turns off prepared statements.

**Pool Size.** In session mode every client connection holds a database connection, and the pooler
accepts at most _Pool Size_ of them (Database → Settings). Keep `DATABASE_POOL_MAX` (default 10) ×
voice instances, plus migrations and any web instances on the session pooler, below that value, or
raise Pool Size. Beyond it, new connections wait and then fail with "Max client connections reached".

**Only `DATABASE_URL` is needed.** JustCall talks to Postgres directly and never reads `SUPABASE_URL`,
the anon key or the service-role key, so don't set them anywhere.

**Password.** Reset (rotate) the database password under Dashboard → **Database → Settings**
(`https://supabase.com/dashboard/project/<ref>/database/settings`), then update `DATABASE_URL` on every
host with the new percent-encoded password. Right after a reset the pooler can briefly refuse logins
with `28P01 password authentication failed`; retrying with the new password usually works within
seconds. Don't reset several times in a row. Rotate the password whenever it was shared in a chat, an
email or a screenshot.

**Plan.** Free projects pause after 1 week of inactivity and have no backups, and a paused database
makes every call fail. Upgrade to **Pro** (from USD 25/month) before you connect a real restaurant. Pro
projects are backed up daily and automatically (7 days kept), so there is nothing to switch on.
Point-in-time recovery is an optional add-on (USD 100/month per 7 days of retention, needs at least
the Small compute add-on, and replaces the daily backups).

Apply the schema (creates all tables, locks down Supabase's public REST API with row level security):

```bash
pnpm db:migrate
pnpm db:seed        # optional: demo restaurant "Pizzeria Bella Vista" with a full menu
```

## 2. OpenAI – the language model

1. <https://platform.openai.com> → **API keys** → _Create new secret key_ inside your project
   (project keys start with `sk-proj-`). If you give the key an expiry date, put a reminder in your
   calendar: the assistant stops answering when the key expires.
2. **Credits and usage tier.** Your tier rises automatically with the total credits you have bought:
   _Build_ (USD 5: 5,000 requests and 2M tokens per minute, at most USD 500 usage per month), _Launch_
   (USD 100: 10,000 RPM, 10M TPM, USD 5,000/month) and _Grow_ (USD 500). Buy at least **USD 100** of
   credits to reach Launch before going live with up to 50 parallel calls. Keep the balance topped up
   (or turn on auto-recharge): requests fail when the credits run out (`credit_balance_exhausted`) or
   the tier's monthly limit is reached (`organization_usage_limit_exceeded`).
3. **Spend limits and alerts**: Settings → Organization → **Limits**
   (<https://platform.openai.com/settings/organization/limits>), or Project settings → Limits for one
   project. Under _Spend_ click _Edit spend limit_, enter a _Monthly spend limit_ and add spend alerts,
   which only send an email. If you also turn on _Enforce a hard limit_, every request fails with
   HTTP 429 (`organization_spend_limit_exceeded` / `project_spend_limit_exceeded`) once the cap is
   reached, and the phone assistant stops answering on every line until you raise the limit or the
   month resets. Rely on alerts for early warning and set any hard limit well above the expected
   monthly spend. Your current tier and rate limits are shown on the same page.
4. Set:
   ```
   LLM_PROVIDER=openai
   OPENAI_API_KEY=sk-proj-…
   OPENAI_MODEL=gpt-5.4-mini
   OPENAI_REASONING_EFFORT=none
   ```

**Choosing the model.** On the phone, speed matters as much as intelligence (callers notice pauses
above ~1.5 s). The assistant never computes prices or invents menu items (the server does that), so a
small, fast model is enough. Prices are USD per million input / output tokens.

| Model                    | When to use                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gpt-5.4-mini` (default) | Proven balance of speed, cost and tool calling (0.75 / 4.50). Start here.                                                                                                                            |
| `gpt-6-luna`             | Newest small model and the cheapest in this table (0.10 / 0.50). Calls tools only with `OPENAI_REASONING_EFFORT=none`, which is the default. Compare it with `pnpm eval` before you make it default. |
| `gpt-4.1-mini`           | Fast fallback if a newer model behaves differently (0.40 / 1.60). Not a reasoning model, so it ignores `OPENAI_REASONING_EFFORT`.                                                                    |
| `gpt-5.5`                | Smarter but slower and pricier (5 / 30), for complex menus. `gpt-5.6-sol` and `gpt-6-sol` (only with effort `none`) are newer flagship models that also work with JustCall.                          |

Do not use:

- `gpt-5.4-nano`: deprecated, shuts down on 1 April 2027 (OpenAI's replacement is `gpt-6-luna`).
- `gpt-6-astra` and `gpt-6.1-sol`: JustCall calls tools through Chat Completions, which does not
  support function calling with these two models, and both reject effort `none`. A restaurant set to
  one of them cannot place orders. This also applies to the per-restaurant model override.

`OPENAI_REASONING_EFFORT` accepts `none` (recommended for phone latency), `low` or `medium` for the
models above. `minimal` exists only for the older `gpt-5` / `gpt-5-mini` / `gpt-5-nano`, which in turn
don't accept `none`. `gpt-5.5` thinks at `medium` unless the effort is set, so keep `none`.

Compare models objectively with the evaluation harness. It runs nine scripted Swiss German calls
(ordering, aliases, allergy transfer, owner request, delivery, changes, prompt injection) and prints the
pass rate and the time to the first spoken sentence:

```bash
OPENAI_MODEL=gpt-5.4-mini pnpm eval
OPENAI_MODEL=gpt-6-luna pnpm eval
```

The model can also be overridden per restaurant (Restaurant → Settings → Voice assistant).

**AI menu import** (Menu → Import → _AI (text or photo)_) always uses OpenAI, even when calls run on
Claude, so the web app needs `OPENAI_API_KEY`. `OPENAI_MENU_MODEL` picks a different model for the
import (default: `OPENAI_MODEL`).

**Claude instead of OpenAI (optional).** Create an API key in the Claude Console
(<https://platform.claude.com>) and set `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY` and
`ANTHROPIC_MODEL=claude-haiku-5-5` (the fastest Claude model, USD 0.10 / 0.50). The adapter turns
thinking off (or to low effort) and leaves out `temperature` for models that reject it. Test it before
switching: `LLM_PROVIDER=anthropic pnpm eval`. Account limits: the Start tier has a USD 500 monthly
spend cap, and once it is reached the API returns 429 until the 1st of the next month. New
organizations can start in a lower evaluation tier, so use _Request tier increase_ on the Console's
Rate limits page before going live.

## 3. Twilio – phone numbers, calls and SMS ⏳

1. Sign up at <https://www.twilio.com>, verify your email and phone, and **upgrade the account before
   any end-to-end test**. JustCall cannot run on a trial: trial calls strip `<Stream>` (the AI audio)
   and `<Dial><Number>` (transfers) and play "The … verb is not available on trial accounts" instead.
   Trials also reach only verified numbers, send only template SMS (no alphanumeric sender) and expire
   after 30 days.
2. **Business Primary Customer Profile** ⏳ – Console → Account (Admin) menu → Trust Hub → Customer
   Profiles → create a **Business** profile (company details and an authorized representative). Accounts upgraded on or
   after 3 Feb 2026 are limited to **2 concurrent calls** without an approved Business profile (3 with
   an individual profile), and the next caller fails with error 10004. Each transferred call counts
   twice (caller leg plus transfer leg). With an approved Business profile, concurrency is unlimited
   and inbound calls and `<Dial>` transfers are not rate limited. Twilio publishes no approval time,
   so submit it right after upgrading.
3. **Regulatory bundle for Switzerland** ⏳ – Console → Phone Numbers → _Regulatory Compliance_ →
   _Bundles_ → _Create a Regulatory Bundle_ → Switzerland, number type **Local**, end-user type
   **Business**. You need the company name, a business address in Switzerland, the UID and an excerpt
   from the commercial register (Handelsregisterauszug) showing that address. Review usually takes up
   to 3 business days, sometimes several weeks. Note the **Bundle SID** (`BU…`) and the **Address SID**
   (`AD…`) → `TWILIO_CH_BUNDLE_SID`, `TWILIO_CH_ADDRESS_SID` (needed to buy numbers in JustCall).
   - Twilio sells three Swiss number types: **Local**, **Mobile** (+41 7x, SMS only, cannot receive
     calls) and **Toll-Free** (+41 800, businesses only). There is no "National" type. Restaurants
     need **Local** numbers.
   - **Ask Twilio support before you buy many numbers** whether one JustCall bundle may cover numbers
     used by many restaurants, or whether each restaurant needs its own bundle (Twilio defines the
     end-user as the business that answers the calls). JustCall supports one `TWILIO_CH_BUNDLE_SID`
     today.
4. **Buy a number** per restaurant (e.g. a 044 number for Zürich; stock varies by area code), in the
   Twilio console or in JustCall → Phone numbers → _Buy a Swiss number_ (it searches Local numbers
   only).
5. **Credentials** → `TWILIO_ACCOUNT_SID` (`AC…`) and `TWILIO_AUTH_TOKEN`:
   - legacy Console (console.twilio.com): the **Account Info** pane on the account dashboard (click
     _show_ to reveal the Auth Token);
   - new Console (1console.twilio.com): Settings → Account settings → **API keys & auth tokens** →
     _Auth Tokens_ tab.
6. **Geo permissions**: Voice → Settings → Geo permissions (transfers to the owner's mobile) and
   Messaging → Settings → Geo permissions (SMS to callers): allow **Switzerland**. New accounts allow
   SMS only to the sign-up country. Only the Owner and Administrator roles can change them.
7. **SMS sender**: first enable **Alphanumeric Sender ID** under Messaging → Settings → General. Then
   set `TWILIO_SMS_FROM=JustCall` (max. 11 characters: letters, digits and spaces, not digits only; no
   registration needed in Switzerland). Each restaurant can override it with its own name (e.g.
   `BellaVista`). A Messaging Service SID (`MG…`) works too. The Swiss **local** numbers JustCall buys
   **cannot send SMS**; the only Swiss number that can is a separate Swiss mobile number (USD 9/month,
   SMS only, with its own Mobile bundle). Alphanumeric senders are one-way, so callers can't reply, and
   Twilio cannot send SMS to landlines (error 21614): only callers on a mobile get the confirmation.
8. `TWILIO_EDGE=frankfurt` only changes the hostname of Twilio's REST API (number management,
   transfers, SMS). It has no effect on call audio: calls, webhooks and Media Streams run in Twilio's
   default US1 region either way. Keeping it is harmless. Processing calls in Ireland (Twilio's IE1
   region) would need a code change.

**Prices** (Twilio list prices, October 2026): Swiss local number ~USD 1.15/month, incoming calls
~USD 0.01/min, Media Streams ~USD 0.0044/min, transfers to Swiss mobiles ~USD 0.18/min (landlines
~USD 0.04/min) on top of the incoming call, SMS ~USD 0.077 per segment. A minute of transfer to a
mobile costs about 18 times the incoming-call rate. [OPERATIONS.md](OPERATIONS.md#costs) has the cost
per order.

You do **not** need to configure webhooks by hand: when you connect a number to a restaurant in JustCall
(Restaurant → Phone), the voice webhook and status callback are set automatically to
`VOICE_PUBLIC_URL/twilio/voice` and `/twilio/status`, and the fallback URL to
`APP_URL/api/twilio/fallback` (when `APP_URL` is `https://`).

**How restaurants connect their existing number:** they keep their number and forward calls to the
JustCall number. The Phone tab shows the GSM codes for _overflow_ forwarding (only when busy / not
answered, ideal for rush hours) or _always_. The **transfer number** (owner's mobile) must be a
different number, otherwise transferred calls would loop back.

## 4. AWS – Swiss German speech recognition and voice ⏳

Amazon Transcribe supports streaming recognition of **Swiss German (`de-CH`)** and Amazon Polly has a
Swiss voice (**Sabrina**, generative engine). One AWS account covers both.

1. Create an AWS account (<https://aws.amazon.com>) and choose the **Paid account plan** at sign-up (or
   later: Billing → Upgrade plan). The Free plan closes the account automatically after 6 months or
   when its credits are used up, which would silence every restaurant line. Enable MFA on the root
   user.
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
   _Create access key_ → use case _Application running outside AWS_ (or _Other_). AWS suggests
   alternatives such as IAM Roles Anywhere; you can continue past that.
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
5. **Quotas** ⏳ – quotas are per region, so switch the console to the region in `AWS_REGION` first
   (an increase in eu-central-1 does not apply in eu-central-2). Service Quotas → _AWS services_ →
   select the quota → _Request increase at account-level_ → enter the value → _Request_:
   - **Amazon Transcribe** → _Number of concurrent streams (HTTP/2 + Websocket)_: default 25 → request
     **100**. Each live call holds one stream, so plan for all restaurants' peak at once. (Not
     _Transactions per second, StartStreamTranscription_, which only limits how fast streams start.)
   - **Amazon Polly** → _Default rate of SynthesizeSpeech (generative) requests_: default 8 per second →
     request about **20**. Every spoken sentence is one request, and 50 parallel calls need roughly
     10–20 per second. Requests above the limit fail with `ThrottlingException`. The neural engine has
     the same default of 8, so switching engines does not avoid the increase.

   Ramp load tests up gradually: starting many streams at once can fail with `LimitExceededException`
   even after the increase.

6. Listen to the voice: Polly console → _Text-to-speech_ → Engine _Generative_, Language _German
   (Swiss)_, voice Sabrina, or use _Preview greeting_ in JustCall (Restaurant → Settings).

Optional: `TRANSCRIBE_VOCABULARY_NAME` uses a custom vocabulary you created in Transcribe (same
language and region), and `TRANSCRIBE_PARTIAL_STABILIZATION=true` turns on partial-result
stabilization.

**Costs** (eu-central-1 and eu-central-2): Transcribe streaming USD 0.01/min, billed per second; Polly
generative USD 30 per million characters (neural USD 16), about USD 0.01 per minute of assistant speech.

**Alternatives** (switch per restaurant or globally, no code change):

- **Azure AI Speech** – recognizes `de-CH` and has Swiss voices (`de-CH-LeniNeural`,
  `de-CH-JanNeural`). Azure portal → create a **Foundry resource for Speech** (older guides call it
  "Speech service"; direct link `portal.azure.com/#create/Microsoft.CognitiveServicesAIFoundry`) →
  Region **Switzerland North** → pricing tier **Standard S0** → _Review + create_ → _Go to resource_ →
  _Resource Management_ → _Keys and Endpoint_ → `AZURE_SPEECH_KEY`,
  `AZURE_SPEECH_REGION=switzerlandnorth`; then `STT_PROVIDER=azure` and/or `TTS_PROVIDER=azure`. Don't
  use the Free tier F0: it allows 1 concurrent recognition, so the second caller gets no transcript.
  S0 allows 100 concurrent recognitions by default. A/B test against AWS with real callers, because
  Swiss German recognition quality differs by dialect.
- **ElevenLabs** – very natural voices, but Standard German only (no Swiss German language). For a
  Swiss sound, pick a Swiss-accented voice from the Voice Library and add it to _My Voices_, or clone a
  Swiss speaker (Professional Voice Cloning, Creator plan or above; Instant cloning may miss the
  accent, and a clone's accent can't be changed later). Copy the voice ID (_My Voices_ → ⋯ → _Copy
  voice ID_) → `TTS_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`. Don't use a
  _Default_ voice: they expire on 31 Dec 2026. Plans cap concurrent requests (Starter 6, Creator 10,
  Pro 20, Scale/Business 30; a slot is held only while audio is generated). Keep
  `ELEVENLABS_MODEL=eleven_flash_v2_5`.
- **OpenAI speech** – `STT_PROVIDER=openai`, `TTS_PROVIDER=openai` work with only an OpenAI key. Good
  for a first end-to-end test; the voice has a German (not Swiss) accent. OpenAI has deprecated the
  default models: `gpt-4o-transcribe` shuts down on 26 Feb 2027 and the dated `gpt-4o-mini-tts`
  snapshots on 6 Jan 2027, so use this path for testing only.
- **Spitch** – Spitch AG (Zurich, Swiss German speech recognition) offers no public self-service API,
  only "Book a demo". The `spitch` SDK, docs.spitch.app and the LiveKit Spitch plugin belong to a
  different company focused on African languages and do not cover Swiss German. The speech layer is
  pluggable (`apps/voice/src/stt/`): once you have API access, an adapter is ~80 lines following
  `azure.ts`.
- **Amazon Nova Sonic / OpenAI Realtime** (speech-to-speech) support German but not Swiss German
  specifically, and do not allow the deterministic safety checks JustCall runs on every transcript.
  They are therefore not used for ordering.

## 5. Email – invoices, invitations, password resets

Any SMTP provider works. Example with **Resend**:

1. <https://resend.com> → _Domains_ → add a **subdomain** such as `mail.justcall.ch` (Resend recommends
   a subdomain over the root domain) and choose the region **EU (Ireland)** in the same dialog. The
   region can't be changed later without deleting the domain and redoing the DNS records. Add the DNS
   records shown; on Cloudflare set them to "DNS only". Verification can take up to 72 h.
2. _API keys_ → create a key with _Sending access_.
3. Set:
   ```
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=465
   SMTP_USER=resend
   SMTP_PASSWORD=re_…
   EMAIL_FROM=JustCall <billing@mail.justcall.ch>
   ```
4. Plan: the free plan sends 100 emails per day (3,000 per month). Order notification emails, invoices,
   invitations and password resets add up quickly, so use **Pro** (USD 20/month, 50,000 emails, no
   daily limit) in production.

Resend keeps account data (logs, metadata) in the US whatever sending region you choose. For email
data in Switzerland use Infomaniak mail (`mail.infomaniak.com`, port 465). Without SMTP, emails are
written to the server log (invitation links are also shown in the UI).

## 6. Secrets

Generate three random secrets (each at least 32 characters):

```bash
openssl rand -base64 32   # BETTER_AUTH_SECRET   web app: signs login sessions
openssl rand -base64 32   # INTERNAL_API_SECRET  identical on web + voice
openssl rand -base64 32   # CRON_SECRET          web app: only for an external invoice scheduler
```

- `INTERNAL_API_SECRET` must be identical on the web app and the voice server.
- `BETTER_AUTH_SECRET` is used by the web app only.
- `CRON_SECRET` protects `/api/cron/monthly-invoices`, which is only needed when the voice server's
  invoice job is off (`JOBS_ENABLED=false`) and an external scheduler triggers invoicing. Leave it
  empty otherwise. Note that `JOBS_ENABLED=false` also stops the daily transcript deletion.
- In production the secrets are required: the voice server refuses to start without
  `INTERNAL_API_SECRET`, and the web app fails without `BETTER_AUTH_SECRET` or `INTERNAL_API_SECRET`. In
  development both fall back to the same insecure built-in value, so local runs work without them.

The Render Blueprint generates all three in the `justcall` environment group.

## 7. Hosting

See [DEPLOYMENT.md](DEPLOYMENT.md). Recommended: **Vercel Pro** (web app, region Frankfurt) +
**Render** or **Fly.io** (voice server, Frankfurt) + **Supabase Pro**. Vercel's Hobby plan is for
non-commercial personal use only; JustCall is a paid service, so it needs Pro. Point two domains at
them, e.g. `app.justcall.ch` → web and `voice.justcall.ch` → voice server, and set
`APP_URL=https://app.justcall.ch`, `VOICE_PUBLIC_URL=https://voice.justcall.ch`.

- Monthly invoices are created by the voice server's job (`JOBS_ENABLED=true`, 1st of the month at
  06:00 Zurich time); there is no Vercel cron. `INVOICE_AUTO_SEND=true` emails them automatically.
- Deploys: the shipped configs give running calls up to 290 s to finish
  (`DRAIN_TIMEOUT_SECONDS=290`, platform shutdown timeout 300 s). Longer calls are cut, so deploy
  outside opening hours when you can.

## 8. First start

```bash
pnpm install
cp .env.example .env      # fill in
pnpm db:migrate
pnpm dev                  # web on :3000, voice server on :8080
pnpm doctor               # checks every integration with a real request
```

Open the web app → `/setup` creates the first administrator (only possible while no user exists;
alternatively `pnpm admin:create --email you@example.ch`). Then fill in **Settings → Company &
invoicing** (company address, IBAN for the QR-bill, VAT) and follow _Guides_ in the admin console:
create restaurant → menu → hours → transfer number → test call → connect number → invite the
restaurant → activate.

For real phone calls during local development, expose the voice server with a tunnel
(`cloudflared tunnel --url http://localhost:8080` or `ngrok http 8080`) and set `VOICE_PUBLIC_URL` to
the HTTPS tunnel URL before connecting a number.

## Giving keys to a Claude Code cloud session

A cloud session reads its environment variables from its **cloud environment**, not from the
repository or the chat. Never paste keys into the chat.

1. At <https://claude.ai/code>, click the cloud icon with the environment's name in the row above the
   message box (in a running session you can also use the cloud environment menu in the session's
   title bar → _Edit_; in the Desktop app the selector is in the prompt box). Select _Cloud_, hover
   over your environment and click the settings (gear) icon to open _Edit environment_.
2. Under **Environment variables**, enter one `KEY=value` per line (`.env` format; quote a value that
   contains `#`). Click **Save changes**.
3. Under **Network access**: the default _Trusted_ level does not allow `api.openai.com` or
   `api.twilio.com` (AWS hosts and `api.anthropic.com` are allowed). Choose _Custom_, add those hosts
   and any other API host you use (e.g. `api.elevenlabs.io`), and keep _Also include default list of
   common package managers_ ticked so `pnpm install` keeps working. _Full_ also works. Network changes
   reach running sessions within about a minute.
4. Start a **new session** to use new variables right away. An open session keeps the values it last
   read until it has been idle for a few minutes and resumes (or its machine is rebuilt); removed or
   rotated keys reach older sessions at that point.

Limits of cloud sessions:

- They only carry HTTP and HTTPS traffic, so a remote Postgres (ports 5432/6543) and SMTP logins fail
  there even with correct values. Use a local Postgres inside the session for tests
  (`TEST_DATABASE_URL`), and run the real database and SMTP checks of `pnpm doctor` from your computer
  or on the deployed voice server.
- Anyone who can use the environment can read its variables. Keep keys in a personal environment, not
  in a shared organization environment (those open read-only; only an Owner can edit them under Admin
  settings → Cloud environments).
- On Pro and Max plans the dialog also offers **Network secrets**, which keep a key outside the session
  and add it to requests for the listed hosts. JustCall reads its keys from environment variables (it
  treats a missing or short `OPENAI_API_KEY` as not set and needs `TWILIO_AUTH_TOKEN` itself to check
  webhook signatures), so for this repository plain environment variables are the practical choice.

## Environment variable reference

Every variable the code reads. **Service**: `web` = Next.js app, `voice` = voice server, `both` = web
and voice, `CLI` = the pnpm scripts (`db:migrate`, `db:seed`, `doctor`, `eval`, `chat`,
`admin:create`), `compose` = `docker-compose.yml` only, `dev` = tests and tooling. Each service reads
only its own variables; the per-host lists are in [DEPLOYMENT.md](DEPLOYMENT.md).

Leave unused variables out (or commented) instead of setting them empty: `APP_URL`, `VOICE_PUBLIC_URL`
(web app), `VOICE_INTERNAL_URL`, `DATABASE_POOL_MAX`, `SMTP_PORT` and `DRAIN_TIMEOUT_SECONDS` use
their default only when the variable is missing, not when it is empty.

| Variable                           | Service     | Default                                                    | Purpose                                                                                                                                                    |
| ---------------------------------- | ----------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Database**                       |             |                                                            |                                                                                                                                                            |
| `DATABASE_URL`                     | both, CLI   | none (required)                                            | PostgreSQL connection. Port 6543 or `pgbouncer=true` turns off prepared statements (transaction pooler).                                                   |
| `DATABASE_POOL_MAX`                | both        | `10`                                                       | Connections per process (CLI scripts use 1). `1`–`3` on Vercel; keep it × instances below the session pooler's Pool Size.                                  |
| `COMPOSE_DATABASE_URL`             | compose     | `postgres://justcall:<POSTGRES_PASSWORD>@db:5432/justcall` | Database URL for the compose containers, e.g. a Supabase URI instead of the bundled Postgres.                                                              |
| `POSTGRES_PASSWORD`                | compose     | `justcall-local-password`                                  | Password of the bundled Postgres (letters and digits only). Applied only when the `pgdata` volume is created.                                              |
| **URLs and server**                |             |                                                            |                                                                                                                                                            |
| `APP_URL`                          | both        | `http://localhost:3000`                                    | Public web app URL: login, links in emails, Twilio fallback URL (only when `https://`), allowed origin for the browser simulator.                          |
| `VOICE_PUBLIC_URL`                 | both, CLI   | `http://localhost:8080`                                    | Public HTTPS URL of the voice server: Twilio webhooks, media stream, simulator, signature checks. `pnpm doctor` checks its `/health`.                      |
| `VOICE_INTERNAL_URL`               | web         | `VOICE_PUBLIC_URL`                                         | Server-to-server voice URL (cache invalidation, voice preview, health check). Compose sets `http://voice:8080`.                                            |
| `PORT`                             | both        | voice `8080`, web `3000`                                   | Listen port. In the root `.env` it only affects the voice server (`pnpm dev` runs the web app on 3000).                                                    |
| `HOST`                             | voice       | `0.0.0.0`                                                  | Bind address of the voice server.                                                                                                                          |
| `NODE_ENV`                         | both        | voice `development`; web set by Next                       | `production` makes the secrets mandatory and switches to JSON logs. Set by the Dockerfiles and hosts; don't put it in `.env`.                              |
| `DRAIN_TIMEOUT_SECONDS`            | voice       | `25`                                                       | On SIGTERM, seconds to wait for running calls before hanging up. Production configs set `290` (below the host's 300 s shutdown timeout).                   |
| `LOG_LEVEL`                        | voice       | `info`                                                     | Log level (pino).                                                                                                                                          |
| `NEXT_OUTPUT`                      | web (build) | unset                                                      | `standalone` builds the Docker image output; set by `apps/web/Dockerfile`.                                                                                 |
| `HOSTNAME`                         | web         | `0.0.0.0` in the Docker image                              | Bind address of the standalone Next server (read by Next).                                                                                                 |
| `NEXT_PHASE`                       | web         | set by Next                                                | Lets `next build` run without secrets. Never set it by hand.                                                                                               |
| **Secrets**                        |             |                                                            |                                                                                                                                                            |
| `BETTER_AUTH_SECRET`               | web         | dev fallback; required in production                       | Signs login sessions.                                                                                                                                      |
| `INTERNAL_API_SECRET`              | both        | dev fallback on both; required in production               | Shared web ↔ voice secret: simulator and media-stream tokens, `/internal/*` calls. Must be identical on both.                                              |
| `CRON_SECRET`                      | web         | empty (the route then returns 401)                         | Bearer token for `/api/cron/monthly-invoices`, only for `JOBS_ENABLED=false` with an external scheduler.                                                   |
| **Language model**                 |             |                                                            |                                                                                                                                                            |
| `LLM_PROVIDER`                     | voice, CLI  | `openai`                                                   | `openai`, `anthropic` or `demo` (rule-based, no key). Phone calls have no fallback; the simulator and `chat` use the demo assistant without a key.         |
| `OPENAI_API_KEY`                   | both, CLI   | none                                                       | OpenAI for calls, OpenAI speech and (web) AI menu import. Values under 20 characters count as placeholders.                                                |
| `OPENAI_MODEL`                     | both, CLI   | `gpt-5.4-mini`                                             | Default call model (the per-restaurant override wins); fallback for menu import.                                                                           |
| `OPENAI_REASONING_EFFORT`          | voice, CLI  | `none`                                                     | `none`, `low` or `medium` for the recommended models. Ignored by non-reasoning models such as `gpt-4.1-mini`.                                              |
| `OPENAI_BASE_URL`                  | both, CLI   | unset (api.openai.com)                                     | OpenAI-compatible endpoint (Azure OpenAI, proxy) for calls, OpenAI speech and menu import.                                                                 |
| `OPENAI_MENU_MODEL`                | web         | `OPENAI_MODEL`, then `gpt-5.4-mini`                        | Model for AI menu import.                                                                                                                                  |
| `ANTHROPIC_API_KEY`                | voice, CLI  | none                                                       | Claude for calls when `LLM_PROVIDER=anthropic`.                                                                                                            |
| `ANTHROPIC_MODEL`                  | voice, CLI  | `claude-haiku-5-5`                                         | Default Claude model (the per-restaurant override wins).                                                                                                   |
| **Speech**                         |             |                                                            |                                                                                                                                                            |
| `STT_PROVIDER`                     | voice       | `aws`                                                      | `aws`, `azure`, `openai` or `mock` (local testing, no keys). Can be overridden per restaurant.                                                             |
| `TTS_PROVIDER`                     | voice       | `polly`                                                    | `polly`, `azure`, `elevenlabs`, `openai` or `mock`. Can be overridden per restaurant.                                                                      |
| `AWS_REGION`                       | voice       | `eu-central-1`                                             | Region for Transcribe and Polly (quotas are per region).                                                                                                   |
| `AWS_ACCESS_KEY_ID`                | voice       | none                                                       | IAM user key for Transcribe and Polly (read by the AWS SDK).                                                                                               |
| `AWS_SECRET_ACCESS_KEY`            | voice       | none                                                       | IAM user secret.                                                                                                                                           |
| `TRANSCRIBE_LANGUAGE`              | voice       | `de-CH`                                                    | Amazon Transcribe language.                                                                                                                                |
| `TRANSCRIBE_VOCABULARY_NAME`       | voice       | unset                                                      | Optional Transcribe custom vocabulary (same language and region).                                                                                          |
| `TRANSCRIBE_PARTIAL_STABILIZATION` | voice       | `false`                                                    | Turns on Transcribe partial-result stabilization.                                                                                                          |
| `POLLY_VOICE`                      | voice       | `Sabrina`                                                  | Polly voice (Swiss German).                                                                                                                                |
| `POLLY_ENGINE`                     | voice       | `generative`                                               | Polly engine (`generative` or `neural` for Sabrina).                                                                                                       |
| `AZURE_SPEECH_KEY`                 | voice       | none                                                       | Azure Speech key (Foundry resource, Standard S0).                                                                                                          |
| `AZURE_SPEECH_REGION`              | voice       | `switzerlandnorth`                                         | Azure Speech region; must match the key.                                                                                                                   |
| `AZURE_STT_LANGUAGE`               | voice       | `de-CH`                                                    | Azure recognition language.                                                                                                                                |
| `AZURE_TTS_VOICE`                  | voice       | `de-CH-LeniNeural`                                         | Azure voice, e.g. `de-CH-JanNeural`.                                                                                                                       |
| `ELEVENLABS_API_KEY`               | voice       | none                                                       | ElevenLabs key.                                                                                                                                            |
| `ELEVENLABS_VOICE_ID`              | voice       | empty                                                      | Voice from _My Voices_ or your clone (not a Default voice).                                                                                                |
| `ELEVENLABS_MODEL`                 | voice       | `eleven_flash_v2_5`                                        | ElevenLabs model.                                                                                                                                          |
| `OPENAI_STT_MODEL`                 | voice       | `gpt-4o-transcribe`                                        | Model for `STT_PROVIDER=openai` (deprecated by OpenAI, shutdown 26 Feb 2027).                                                                              |
| `OPENAI_TTS_MODEL`                 | voice       | `gpt-4o-mini-tts`                                          | Model for `TTS_PROVIDER=openai` (dated snapshots shut down 6 Jan 2027).                                                                                    |
| `OPENAI_TTS_VOICE`                 | voice       | `coral`                                                    | Voice for `TTS_PROVIDER=openai`.                                                                                                                           |
| `TTS_CACHE_MB`                     | voice       | `64`                                                       | In-memory cache for synthesized phrases.                                                                                                                   |
| **Twilio**                         |             |                                                            |                                                                                                                                                            |
| `TWILIO_ACCOUNT_SID`               | both, CLI   | none                                                       | Account SID (`AC…`). Web: buy/connect numbers, webhooks. Voice: transfers, hang-up, SMS.                                                                   |
| `TWILIO_AUTH_TOKEN`                | both, CLI   | none                                                       | REST authentication and `X-Twilio-Signature` checks (voice webhooks, web fallback route).                                                                  |
| `TWILIO_SMS_FROM`                  | voice       | none                                                       | Default SMS sender: alphanumeric ID (max. 11 characters) or Messaging Service SID (`MG…`); not a Swiss local number. Restaurants can override the name.    |
| `TWILIO_EDGE`                      | both        | unset (Twilio's default)                                   | Edge for the Twilio REST API only (e.g. `frankfurt`); no effect on call audio.                                                                             |
| `TWILIO_VALIDATE_SIGNATURES`       | both        | `true`                                                     | Check Twilio signatures. Any value other than `1`/`true`/`yes`/`on` turns it off; use `false` only for local tests.                                        |
| `TWILIO_CH_BUNDLE_SID`             | web         | unset                                                      | Swiss regulatory bundle (`BU…`) for buying numbers in JustCall.                                                                                            |
| `TWILIO_CH_ADDRESS_SID`            | web         | unset                                                      | Swiss address (`AD…`) for buying numbers in JustCall.                                                                                                      |
| **Email**                          |             |                                                            |                                                                                                                                                            |
| `SMTP_HOST`                        | both, CLI   | unset (emails are written to the log)                      | SMTP server. Web: invitations, password resets, invoices. Voice: order emails, auto-sent invoices. Mail counts as configured with host, user and password. |
| `SMTP_PORT`                        | both        | `465`                                                      | SMTP port (465 = implicit TLS).                                                                                                                            |
| `SMTP_USER`                        | both, CLI   | unset                                                      | SMTP user.                                                                                                                                                 |
| `SMTP_PASSWORD`                    | both, CLI   | unset                                                      | SMTP password or API key.                                                                                                                                  |
| `EMAIL_FROM`                       | both        | `JustCall <no-reply@example.ch>`                           | Sender of all emails.                                                                                                                                      |
| **Jobs and call behaviour**        |             |                                                            |                                                                                                                                                            |
| `JOBS_ENABLED`                     | voice       | `true`                                                     | Monthly invoices (1st, 06:00 Zurich, plus a catch-up 30 s after start) and daily maintenance (03:15).                                                      |
| `INVOICE_AUTO_SEND`                | voice       | `false`                                                    | Emails the invoices the voice job creates. The external-scheduler route never sends.                                                                       |
| `TRANSCRIPT_RETENTION_DAYS`        | voice       | `180`                                                      | Daily job deletes transcripts older than this (`0` = keep forever).                                                                                        |
| `CALL_MAX_DURATION_SECONDS`        | voice       | `900`                                                      | Maximum call length; then the assistant hands the call to staff.                                                                                           |
| `END_OF_TURN_MS`                   | voice       | `700`                                                      | Pause after the caller's last words that ends their turn.                                                                                                  |
| `SILENCE_PROMPT_SECONDS`           | voice       | `10`                                                       | Silence before the assistant asks again.                                                                                                                   |
| `BARGE_IN_MIN_WORDS`               | voice       | `2`                                                        | Words the caller must say to interrupt the assistant.                                                                                                      |
| **Tests and tooling**              |             |                                                            |                                                                                                                                                            |
| `TEST_DATABASE_URL`                | dev         | `postgres://postgres@localhost:5433/justcall_test`         | Postgres for the voice integration tests (`pnpm test`).                                                                                                    |
| `E2E_BASE_URL`                     | dev         | `http://localhost:3000`                                    | Playwright base URL.                                                                                                                                       |
| `E2E_EMAIL`                        | dev         | `admin@justcall.test`                                      | Admin account the e2e test uses or creates.                                                                                                                |
| `E2E_PASSWORD`                     | dev         | test fixture value                                         | Password of that admin.                                                                                                                                    |
| `E2E_SCREENSHOTS`                  | dev         | unset (no screenshots)                                     | Directory for full-page e2e screenshots.                                                                                                                   |
| `PW_CHROMIUM_PATH`                 | dev         | unset (Playwright's own Chromium)                          | Use an installed Chromium instead of the Playwright download.                                                                                              |
