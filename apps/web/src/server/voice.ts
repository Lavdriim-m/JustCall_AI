import "server-only";
import { env } from "@/lib/env";

/** Tells the voice server to reload a restaurant (menu/settings changed). Best effort. */
export async function invalidateVoiceCache(restaurantId: string) {
  try {
    await fetch(`${env.voiceInternalUrl}/internal/restaurants/${restaurantId}/invalidate`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.internalSecret}` },
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Voice server not reachable – its cache expires within 30 seconds anyway.
  }
}

export async function voiceHealth(): Promise<{
  ok: boolean;
  activeCalls?: number;
  stt?: string;
  tts?: string;
  llm?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${env.voiceInternalUrl}/health`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return (await res.json()) as { ok: boolean; activeCalls: number };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
