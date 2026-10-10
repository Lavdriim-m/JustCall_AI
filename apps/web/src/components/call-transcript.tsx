import { asc, callEvents, eq } from "@justcall/db";
import { Bot, Info, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { db } from "@/server/db";

/** Read-only transcript (spoken lines and events, without internal tool details). */
export async function CallTranscript({ callId }: { callId: string }) {
  const events = await db
    .select()
    .from(callEvents)
    .where(eq(callEvents.callId, callId))
    .orderBy(asc(callEvents.seq), asc(callEvents.id));
  const visible = events.filter(
    (e) => e.kind !== "tool" && !(e.kind === "system" && e.content?.startsWith("Anruf ")),
  );
  if (!visible.length)
    return <p className="text-sm text-muted">Kein Gesprächsverlauf vorhanden.</p>;
  return (
    <div className="space-y-2.5">
      {visible.map((e) =>
        e.kind === "user" || e.kind === "assistant" ? (
          <div key={e.id} className={cn("flex gap-2", e.kind === "user" && "flex-row-reverse")}>
            <div
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full",
                e.kind === "assistant"
                  ? "bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-200"
                  : "bg-zinc-200 dark:bg-zinc-700",
              )}
            >
              {e.kind === "assistant" ? (
                <Bot className="size-3.5" />
              ) : (
                <User className="size-3.5" />
              )}
            </div>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3 py-1.5 text-sm",
                e.kind === "assistant" ? "surface-muted" : "bg-brand-600 text-white",
              )}
            >
              {e.content}
            </div>
          </div>
        ) : (
          <div key={e.id} className="flex items-center justify-center gap-1.5 text-xs text-muted">
            <Info className="size-3" /> {e.content}
          </div>
        ),
      )}
    </div>
  );
}
