"use client";

import { formatChf } from "@justcall/core";
import { Bot, Mic, MicOff, PhoneOff, Send, User, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { createSimulatorSession } from "@/server/actions/simulator";
import { CAPTURE_WORKLET, Downsampler, decodeMulaw, fromBase64, toBase64 } from "./audio";

type Entry =
  | { kind: "assistant" | "user"; text: string }
  | { kind: "tool"; name: string; args: unknown; result: unknown }
  | { kind: "event"; text: string; tone?: "green" | "yellow" | "red" | "blue" | "purple" };

type SimState = {
  allergyStatus?: string;
  cart?: {
    lines: {
      lineId: string;
      name: string;
      quantity: number;
      options: { optionName: string }[];
      notes: string | null;
      lineTotalCents: number;
    }[];
    subtotalCents: number;
  };
  fulfillment?: {
    type: string;
    requestedFor: string | null;
    address: { street: string } | null;
  } | null;
  customerName?: string | null;
  customerPhone?: string | null;
  paymentMethod?: string | null;
  placedOrder?: { orderNumber: number } | null;
  usage?: { inputTokens: number; outputTokens: number; cachedTokens: number };
};

const SAMPLE_LINES = [
  "Grüezi, ich hätt gern zwei Pizza Napoli und es Cola",
  "Nei, kei Allergie",
  "Das wär alles, ich hol's so schnell wie möglich ab",
  "Müller",
  "Mit TWINT",
  "Ja genau, stimmt",
];

export function Simulator({ restaurantId }: { restaurantId: string }) {
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "ended">("idle");
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [state, setState] = useState<SimState>({});
  const [input, setInput] = useState("");
  const [callerPhone, setCallerPhone] = useState("+41791234567");
  const [showTools, setShowTools] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const ws = useRef<WebSocket | null>(null);
  const audio = useRef<{
    ctx: AudioContext;
    stream: MediaStream;
    node: AudioWorkletNode;
    playhead: number;
    sources: AudioBufferSourceNode[];
  } | null>(null);
  const mutedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries]);
  useEffect(() => () => stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (e: Entry) =>
    setEntries((all) => {
      // Sentences of one answer are streamed separately – show them as one bubble.
      const last = [...all].reverse().find((x) => x.kind !== "tool");
      const lastIndex = last ? all.lastIndexOf(last) : -1;
      if (e.kind === "assistant" && last?.kind === "assistant") {
        const merged = { ...last, text: `${last.text} ${e.text}` };
        return [...all.slice(0, lastIndex), merged, ...all.slice(lastIndex + 1)];
      }
      return [...all, e];
    });

  async function start(selected: "text" | "voice") {
    setMode(selected);
    setEntries([]);
    setState({});
    setStatus("connecting");
    try {
      const { wsUrl } = await createSimulatorSession(restaurantId);
      if (selected === "voice") await startAudio();
      const socket = new WebSocket(wsUrl);
      ws.current = socket;
      socket.onopen = () =>
        socket.send(JSON.stringify({ type: "start", mode: selected, callerPhone }));
      socket.onmessage = (ev) => handle(JSON.parse(ev.data as string));
      socket.onclose = () => {
        setStatus((s) => (s === "connecting" ? "idle" : "ended"));
        stopAudio();
      };
      socket.onerror = () => {
        toast.error(
          "Cannot reach the voice server. Is it running and is VOICE_PUBLIC_URL correct?",
        );
        setStatus("idle");
      };
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
      setStatus("idle");
      stopAudio();
    }
  }

  function handle(msg: Record<string, unknown>) {
    switch (msg.type) {
      case "ready":
        setStatus("live");
        setModel(String(msg.llm ?? ""));
        break;
      case "transcript":
        add({ kind: msg.role === "user" ? "user" : "assistant", text: String(msg.text) });
        break;
      case "tool":
        add({ kind: "tool", name: String(msg.name), args: msg.arguments, result: msg.result });
        break;
      case "state":
        setState(msg.state as SimState);
        break;
      case "order":
        add({
          kind: "event",
          text: `Order #${msg.orderNumber} created (test order, not billed)`,
          tone: "green",
        });
        break;
      case "sms":
        add({ kind: "event", text: `SMS to customer:\n${String(msg.text)}`, tone: "blue" });
        break;
      case "transfer":
        add({
          kind: "event",
          text: `Call transferred to ${String(msg.target)} (reason: ${String(msg.reason)})`,
          tone: "yellow",
        });
        break;
      case "hangup":
        add({ kind: "event", text: "Assistant hung up", tone: "purple" });
        break;
      case "error":
        add({ kind: "event", text: `Error: ${String(msg.message)}`, tone: "red" });
        break;
      case "media":
        playAudio(String(msg.payload));
        break;
      case "mark":
        scheduleMark(String(msg.name));
        break;
      case "clear":
        clearAudio();
        break;
    }
  }

  async function startAudio() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    const ctx = new AudioContext();
    const url = URL.createObjectURL(
      new Blob([CAPTURE_WORKLET], { type: "application/javascript" }),
    );
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, "jc-capture");
    const down = new Downsampler(ctx.sampleRate);
    let pending: number[] = [];
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      const bytes = down.process(e.data);
      for (const b of bytes) pending.push(mutedRef.current ? 0xff : b);
      while (pending.length >= 160) {
        const frame = Uint8Array.from(pending.slice(0, 160));
        pending = pending.slice(160);
        if (ws.current?.readyState === WebSocket.OPEN) {
          ws.current.send(JSON.stringify({ event: "media", media: { payload: toBase64(frame) } }));
        }
      }
    };
    source.connect(node);
    audio.current = { ctx, stream, node, playhead: 0, sources: [] };
  }

  function playAudio(b64: string) {
    const a = audio.current;
    if (!a) return;
    const samples = decodeMulaw(fromBase64(b64));
    const buffer = a.ctx.createBuffer(1, samples.length, 8000);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = a.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(a.ctx.destination);
    const startAt = Math.max(a.ctx.currentTime + 0.05, a.playhead);
    src.start(startAt);
    a.playhead = startAt + buffer.duration;
    a.sources.push(src);
    src.onended = () => {
      if (audio.current) audio.current.sources = audio.current.sources.filter((s) => s !== src);
    };
  }

  function scheduleMark(name: string) {
    const a = audio.current;
    const delay = a ? Math.max(0, (a.playhead - a.ctx.currentTime) * 1000) : 0;
    setTimeout(() => {
      if (ws.current?.readyState === WebSocket.OPEN)
        ws.current.send(JSON.stringify({ event: "mark", mark: { name } }));
    }, delay);
  }

  function clearAudio() {
    const a = audio.current;
    if (!a) return;
    for (const s of a.sources) {
      try {
        s.stop();
      } catch {}
    }
    a.sources = [];
    a.playhead = a.ctx.currentTime;
  }

  function stopAudio() {
    const a = audio.current;
    if (!a) return;
    a.stream.getTracks().forEach((t) => t.stop());
    a.node.disconnect();
    void a.ctx.close();
    audio.current = null;
  }

  function stop() {
    if (ws.current?.readyState === WebSocket.OPEN)
      ws.current.send(JSON.stringify({ type: "hangup" }));
    ws.current?.close();
    ws.current = null;
    stopAudio();
  }

  function send(text: string) {
    if (!text.trim() || ws.current?.readyState !== WebSocket.OPEN) return;
    ws.current.send(JSON.stringify({ type: "text", text }));
    setInput("");
  }

  const live = status === "live";
  const visible = entries.filter((e) => showTools || e.kind !== "tool");
  const nextSample = SAMPLE_LINES[entries.filter((e) => e.kind === "user").length];

  return (
    <div className="grid gap-6 xl:grid-cols-3">
      <Card className="flex min-h-[560px] flex-col xl:col-span-2">
        <CardHeader
          title="Test call"
          description={
            live
              ? `Connected · ${mode === "voice" ? "voice" : "text"} · model ${model}`
              : "Talk to this restaurant's assistant exactly like a caller would."
          }
          actions={
            live ? (
              <>
                {mode === "voice" ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      mutedRef.current = !mutedRef.current;
                      setMuted(mutedRef.current);
                    }}
                  >
                    {muted ? <MicOff /> : <Mic />} {muted ? "Unmute" : "Mute"}
                  </Button>
                ) : null}
                <Button size="sm" variant="destructive" onClick={stop}>
                  <PhoneOff /> Hang up
                </Button>
              </>
            ) : null
          }
        />
        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto p-5"
          style={{ maxHeight: 520 }}
        >
          {status === "idle" || (status === "ended" && entries.length === 0) ? (
            <div className="space-y-4">
              <Field label="Caller number (for the SMS preview)" htmlFor="caller">
                <Input
                  id="caller"
                  value={callerPhone}
                  onChange={(e) => setCallerPhone(e.target.value)}
                  className="max-w-xs"
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => start("text")}>
                  <Send /> Start text conversation
                </Button>
                <Button variant="secondary" onClick={() => start("voice")}>
                  <Mic /> Start voice call (microphone)
                </Button>
              </div>
              <Notice tone="info">
                Text mode tests the conversation logic and prompts (uses the configured language
                model, or the rule-based demo model without an API key). Voice mode also tests
                speech recognition and the voice – it needs STT/TTS providers configured on the
                voice server. Use headphones to avoid echo. Test orders are stored but never billed.
              </Notice>
            </div>
          ) : null}
          {status === "connecting" ? <p className="text-sm text-muted">Connecting…</p> : null}
          {visible.map((e, i) =>
            e.kind === "assistant" || e.kind === "user" ? (
              <div key={i} className={cn("flex gap-2", e.kind === "user" && "flex-row-reverse")}>
                <div
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full",
                    e.kind === "assistant"
                      ? "bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                      : "bg-zinc-200 dark:bg-zinc-700",
                  )}
                >
                  {e.kind === "assistant" ? (
                    <Bot className="size-4" />
                  ) : (
                    <User className="size-4" />
                  )}
                </div>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm",
                    e.kind === "assistant" ? "surface-muted" : "bg-brand-600 text-white",
                  )}
                >
                  {e.text}
                </div>
              </div>
            ) : e.kind === "tool" ? (
              <details
                key={i}
                className="ml-9 rounded-lg border border-dashed border-default px-3 py-1.5 text-xs text-muted"
              >
                <summary className="cursor-pointer">
                  <Wrench className="mr-1 inline size-3" /> {e.name}
                </summary>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap">
                  {JSON.stringify({ arguments: e.args, result: e.result }, null, 2)}
                </pre>
              </details>
            ) : (
              <div key={i} className="flex justify-center">
                {e.text.includes("\n") ? (
                  <div className="max-w-md whitespace-pre-wrap rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 font-mono text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200">
                    {e.text}
                  </div>
                ) : (
                  <Badge tone={(e as Extract<Entry, { kind: "event" }>).tone ?? "neutral"}>
                    {e.text}
                  </Badge>
                )}
              </div>
            ),
          )}
          {status === "ended" ? (
            <div className="flex justify-center pt-2">
              <Button variant="secondary" onClick={() => setStatus("idle")}>
                New test call
              </Button>
            </div>
          ) : null}
        </div>
        {live ? (
          <form
            className="flex gap-2 border-t border-default p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === "voice" ? "Speak, or type here…" : "Type what the caller says…"}
              autoFocus
            />
            <Button type="submit">
              <Send />
            </Button>
            {nextSample ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => send(nextSample)}
                title={nextSample}
              >
                Example
              </Button>
            ) : null}
          </form>
        ) : null}
      </Card>
      <div className="space-y-6">
        <Card>
          <CardHeader
            title="Order state"
            description="What the system has recorded (authoritative, not the AI's memory)."
          />
          <CardBody className="space-y-3 text-sm">
            <Row
              label="Allergy question"
              value={
                state.allergyStatus === "none"
                  ? "No allergies"
                  : state.allergyStatus === "reported"
                    ? "Allergy reported → transfer"
                    : "Not answered yet"
              }
            />
            <div>
              <div className="text-muted">Cart</div>
              {state.cart?.lines.length ? (
                <ul className="mt-1 space-y-1">
                  {state.cart.lines.map((l) => (
                    <li key={l.lineId} className="flex justify-between gap-2">
                      <span>
                        {l.quantity}× {l.name}
                        {l.options.length ? (
                          <span className="text-muted">
                            {" "}
                            ({l.options.map((o) => o.optionName).join(", ")})
                          </span>
                        ) : null}
                        {l.notes ? <span className="text-muted"> – {l.notes}</span> : null}
                      </span>
                      <span className="tabular-nums">{formatChf(l.lineTotalCents)}</span>
                    </li>
                  ))}
                  <li className="flex justify-between border-t border-default pt-1 font-medium">
                    <span>Subtotal</span>
                    <span>{formatChf(state.cart.subtotalCents)}</span>
                  </li>
                </ul>
              ) : (
                <div>–</div>
              )}
            </div>
            <Row
              label="Pickup / delivery"
              value={
                state.fulfillment
                  ? `${state.fulfillment.type === "delivery" ? "Delivery" : "Pickup"} ${state.fulfillment.requestedFor ? new Date(state.fulfillment.requestedFor).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" }) : "ASAP"}`
                  : "–"
              }
            />
            <Row label="Name" value={state.customerName ?? "–"} />
            <Row label="SMS to" value={state.customerPhone ?? "–"} />
            <Row label="Payment" value={state.paymentMethod ?? "–"} />
            <Row
              label="Order"
              value={state.placedOrder ? `#${state.placedOrder.orderNumber}` : "–"}
            />
            {state.usage ? (
              <Row
                label="Tokens"
                value={`${state.usage.inputTokens} in (${state.usage.cachedTokens} cached) / ${state.usage.outputTokens} out`}
              />
            ) : null}
            <label className="flex items-center gap-2 pt-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={showTools}
                onChange={(e) => setShowTools(e.target.checked)}
                className="accent-brand-600"
              />
              Show tool calls in the transcript
            </label>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
