/**
 * Compact HMAC-signed tokens (header-less JWT-like) shared between the web app and the voice server,
 * e.g. for the browser simulator or Twilio stream parameters. Works in Node.js 18+ (WebCrypto).
 */

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return b64url(new Uint8Array(sig));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signToken(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds = 300,
): Promise<string> {
  if (!secret || secret.length < 16)
    throw new Error("Signing secret must be at least 16 characters");
  const body = b64url(
    new TextEncoder().encode(
      JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }),
    ),
  );
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifyToken<T extends Record<string, unknown>>(
  token: string,
  secret: string,
): Promise<T | null> {
  if (!token || !secret) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = await hmac(secret, body);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & {
      exp?: number;
    };
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
