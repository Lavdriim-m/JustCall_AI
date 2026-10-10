import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getCurrentUser } from "@/server/session";

export const dynamic = "force-dynamic";

/** Proxies a voice preview request to the voice server (which owns the TTS credentials). */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin")
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    provider?: string;
    voice?: string;
    text?: string;
  };
  try {
    const res = await fetch(`${env.voiceInternalUrl}/internal/tts-preview`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.internalSecret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: body.provider || undefined,
        voice: body.voice || undefined,
        text: String(body.text ?? "").slice(0, 400),
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      return NextResponse.json(
        { error: err.error ?? `Voice server responded ${res.status}` },
        { status: 502 },
      );
    }
    return new NextResponse(await res.arrayBuffer(), {
      headers: { "content-type": "audio/wav", "cache-control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Voice server not reachable (${err instanceof Error ? err.message : String(err)})` },
      { status: 502 },
    );
  }
}
