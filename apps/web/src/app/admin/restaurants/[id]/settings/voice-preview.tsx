"use client";

import { Volume2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function VoicePreview({
  provider,
  voice,
  text,
}: {
  provider: string | null;
  voice: string | null;
  text: string;
}) {
  const [busy, setBusy] = useState(false);
  async function play() {
    setBusy(true);
    try {
      const res = await fetch("/api/tts-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, voice, text }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      toast.error(`Voice preview failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button type="button" variant="secondary" onClick={play} disabled={busy}>
      <Volume2 /> {busy ? "Synthesising…" : "Preview greeting (saved voice)"}
    </Button>
  );
}
