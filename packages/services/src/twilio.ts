import twilio from "twilio";

type Env = Record<string, string | undefined>;

export function isTwilioConfigured(env: Env = process.env): boolean {
  return Boolean(
    env.TWILIO_ACCOUNT_SID?.startsWith("AC") &&
    env.TWILIO_AUTH_TOKEN &&
    env.TWILIO_AUTH_TOKEN.length >= 16,
  );
}

let cached: { key: string; client: twilio.Twilio } | null = null;

/** Lazily created REST client (null when Twilio is not configured). */
export function getTwilioClient(env: Env = process.env): twilio.Twilio | null {
  if (!isTwilioConfigured(env)) return null;
  const key = `${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_EDGE ?? ""}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      client: twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, {
        edge: env.TWILIO_EDGE || undefined,
        autoRetry: true,
        maxRetries: 3,
      }),
    };
  }
  return cached.client;
}

export function requireTwilio(env: Env = process.env): twilio.Twilio {
  const client = getTwilioClient(env);
  if (!client)
    throw new Error("Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).");
  return client;
}

/** Validates the X-Twilio-Signature header of a webhook request. */
export function validateTwilioSignature(
  signature: string | undefined,
  url: string,
  params: Record<string, string>,
  env: Env = process.env,
): boolean {
  if (!signature || !env.TWILIO_AUTH_TOKEN) return false;
  return twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params);
}

export type IncomingNumber = {
  sid: string;
  phoneNumber: string;
  friendlyName: string;
  voiceUrl: string | null;
  capabilities: { voice: boolean; sms: boolean };
};

export async function listIncomingNumbers(env: Env = process.env): Promise<IncomingNumber[]> {
  const client = requireTwilio(env);
  const numbers = await client.incomingPhoneNumbers.list({ limit: 200 });
  return numbers.map((n) => ({
    sid: n.sid,
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
    voiceUrl: n.voiceUrl ?? null,
    capabilities: { voice: Boolean(n.capabilities?.voice), sms: Boolean(n.capabilities?.sms) },
  }));
}

export function voiceWebhookUrls(voiceBaseUrl: string) {
  const base = voiceBaseUrl.replace(/\/$/, "");
  return {
    voiceUrl: `${base}/twilio/voice`,
    statusCallback: `${base}/twilio/status`,
  };
}

/** Points a Twilio number's voice webhooks at the JustCall voice server. */
export async function configureNumberWebhooks(
  numberSid: string,
  voiceBaseUrl: string,
  env: Env = process.env,
  /** Web app URL that forwards callers to the restaurant if the voice server is unreachable. */
  fallbackUrl?: string | null,
) {
  const client = requireTwilio(env);
  const urls = voiceWebhookUrls(voiceBaseUrl);
  return client.incomingPhoneNumbers(numberSid).update({
    voiceUrl: urls.voiceUrl,
    voiceMethod: "POST",
    voiceFallbackUrl: fallbackUrl ?? undefined,
    voiceFallbackMethod: fallbackUrl ? "POST" : undefined,
    statusCallback: urls.statusCallback,
    statusCallbackMethod: "POST",
  });
}

export async function searchAvailableNumbers(
  opts: {
    country?: string;
    type?: "local" | "mobile" | "national";
    contains?: string;
    limit?: number;
  },
  env: Env = process.env,
) {
  const client = requireTwilio(env);
  const country = client.availablePhoneNumbers(opts.country ?? "CH");
  const params = {
    voiceEnabled: true,
    contains: opts.contains || undefined,
    limit: opts.limit ?? 20,
  };
  const list =
    opts.type === "mobile"
      ? await country.mobile.list(params)
      : opts.type === "national"
        ? await country.national.list(params)
        : await country.local.list(params);
  return list.map((n) => ({
    phoneNumber: n.phoneNumber,
    friendlyName: n.friendlyName,
    locality: n.locality,
    region: n.region,
    capabilities: n.capabilities,
  }));
}

export async function purchaseNumber(
  phoneNumber: string,
  voiceBaseUrl: string,
  env: Env = process.env,
  fallbackUrl?: string | null,
) {
  const client = requireTwilio(env);
  const urls = voiceWebhookUrls(voiceBaseUrl);
  return client.incomingPhoneNumbers.create({
    phoneNumber,
    voiceUrl: urls.voiceUrl,
    voiceMethod: "POST",
    voiceFallbackUrl: fallbackUrl ?? undefined,
    voiceFallbackMethod: fallbackUrl ? "POST" : undefined,
    statusCallback: urls.statusCallback,
    statusCallbackMethod: "POST",
    bundleSid: env.TWILIO_CH_BUNDLE_SID || undefined,
    addressSid: env.TWILIO_CH_ADDRESS_SID || undefined,
  });
}

/** Sends an SMS. `from` may be a number, an alphanumeric sender ID or a Messaging Service SID. */
export async function sendSms(
  to: string,
  body: string,
  from?: string | null,
  env: Env = process.env,
) {
  const client = requireTwilio(env);
  const sender = (from || env.TWILIO_SMS_FROM || "").trim();
  if (!sender) throw new Error("No SMS sender configured (TWILIO_SMS_FROM).");
  const params = sender.startsWith("MG")
    ? { to, body, messagingServiceSid: sender }
    : { to, body, from: sanitizeSenderId(sender) };
  return client.messages.create(params);
}

/** Alphanumeric sender IDs: max 11 chars, letters/digits/space, must contain a letter. */
export function sanitizeSenderId(sender: string): string {
  if (sender.startsWith("+")) return sender;
  const cleaned = sender
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .slice(0, 11)
    .trim();
  return /[A-Za-z]/.test(cleaned) ? cleaned : "JustCall";
}

function escapeXml(s: string) {
  return s.replace(
    /[<>&"']/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

/**
 * Replaces the live call's instructions with a <Dial> to the restaurant. The media stream ends,
 * the caller hears ringing and is connected to staff. If nobody answers, Twilio requests the
 * action URL, which plays a fallback message.
 */
export async function transferCall(
  callSid: string,
  target: string,
  opts: {
    actionUrl?: string;
    timeoutSeconds?: number;
    callerId?: string | null;
    whisper?: string | null;
  } = {},
  env: Env = process.env,
) {
  const client = requireTwilio(env);
  const attrs = [
    `timeout="${opts.timeoutSeconds ?? 25}"`,
    opts.actionUrl ? `action="${escapeXml(opts.actionUrl)}" method="POST"` : "",
    opts.callerId ? `callerId="${escapeXml(opts.callerId)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial ${attrs}><Number>${escapeXml(target)}</Number></Dial></Response>`;
  return client.calls(callSid).update({ twiml });
}

export async function hangupCall(callSid: string, env: Env = process.env) {
  const client = requireTwilio(env);
  return client.calls(callSid).update({ status: "completed" });
}

export async function verifyTwilioCredentials(env: Env = process.env) {
  const client = requireTwilio(env);
  const account = await client.api.v2010.accounts(env.TWILIO_ACCOUNT_SID!).fetch();
  return { friendlyName: account.friendlyName, status: account.status, type: account.type };
}
