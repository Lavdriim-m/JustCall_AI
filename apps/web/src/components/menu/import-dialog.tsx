"use client";

import { formatChf } from "@justcall/core";
import { Sparkles, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/misc";
import { parseMenuWithAi } from "@/server/actions/ai-menu";
import { importMenuAction } from "@/server/actions/menu";
import { parseMenuCsv, type ImportedMenu } from "./csv";

export function ImportDialog({
  restaurantId,
  open,
  onOpenChange,
  aiAvailable,
}: {
  restaurantId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  aiAvailable: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"ai" | "csv" | "json">(aiAvailable ? "ai" : "csv");
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportedMenu | null>(null);
  const [replace, setReplace] = useState(false);
  const [pending, start] = useTransition();

  const analyse = () =>
    start(async () => {
      try {
        if (mode === "json") setPreview(JSON.parse(text) as ImportedMenu);
        else if (mode === "csv") setPreview(parseMenuCsv(text));
        else {
          const res = await parseMenuWithAi(restaurantId, {
            text,
            imageDataUrl: image ?? undefined,
          });
          if (res?.error) return void toast.error(res.error);
          setPreview(res?.data as ImportedMenu);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    });

  const doImport = () =>
    start(async () => {
      if (!preview) return;
      const res = await importMenuAction(restaurantId, preview, replace);
      if (res?.error) return void toast.error(res.error);
      toast.success(res?.message ?? "Imported");
      setPreview(null);
      setText("");
      setImage(null);
      onOpenChange(false);
      router.refresh();
    });

  const itemCount = preview?.categories.reduce((a, c) => a + c.items.length, 0) ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Import menu"
        description="Bring a restaurant's menu in within minutes, then fine-tune aliases and options."
        wide
      >
        {!preview ? (
          <div className="space-y-4">
            <div className="flex gap-1 rounded-lg border border-default p-1 text-sm">
              {(
                [
                  ["ai", "AI (text or photo)"],
                  ["csv", "CSV / Excel"],
                  ["json", "JSON"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMode(key)}
                  className={`flex-1 rounded-md px-3 py-1.5 ${mode === key ? "bg-brand-600 text-white" : "text-muted hover:bg-[var(--surface-muted)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {mode === "ai" && !aiAvailable ? (
              <Notice tone="warning">
                AI import needs OPENAI_API_KEY on the server. Use CSV or JSON instead.
              </Notice>
            ) : null}
            {mode === "ai" ? (
              <>
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={10}
                  placeholder="Paste the menu text (from the website, a PDF, …)"
                />
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted">
                  <Upload className="size-4" />
                  {image
                    ? "Photo attached ✓ (click to change)"
                    : "…or upload a photo of the printed menu"}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setImage(String(reader.result));
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
              </>
            ) : (
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={12}
                className="font-mono text-xs"
                placeholder={
                  mode === "csv"
                    ? 'category,name,price,code,aliases,description,options\nPizza,Pizza Napoli,18.50,3,Napoli|Combo 3,"Tomaten, Mozzarella, Sardellen",Grösse|Pizza-Extras'
                    : '{"categories":[{"name":"Pizza","items":[{"name":"Pizza Napoli","priceCents":1850,"aliases":["Combo 3"]}]}]}'
                }
              />
            )}
            <div className="flex justify-end">
              <Button
                onClick={analyse}
                disabled={pending || (!text.trim() && !image) || (mode === "ai" && !aiAvailable)}
              >
                {mode === "ai" ? <Sparkles /> : null}
                {pending ? "Analysing…" : "Preview"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              {itemCount} items in {preview.categories.length} categories
              {preview.optionGroups?.length ? `, ${preview.optionGroups.length} option groups` : ""}
              .
            </p>
            <div className="max-h-[50vh] space-y-3 overflow-y-auto rounded-lg border border-default p-3 text-sm">
              {preview.optionGroups?.map((g) => (
                <div key={g.name} className="text-xs text-muted">
                  <span className="font-medium text-[var(--text)]">{g.name}</span> (
                  {g.minSelect > 0 ? "required" : "optional"}):{" "}
                  {g.options
                    .map(
                      (o) =>
                        `${o.name}${o.priceDeltaCents ? ` +${formatChf(o.priceDeltaCents, { withCurrency: false })}` : ""}`,
                    )
                    .join(", ")}
                </div>
              ))}
              {preview.categories.map((c) => (
                <div key={c.name}>
                  <div className="font-medium">{c.name}</div>
                  <ul className="mt-1 space-y-0.5">
                    {c.items.map((i, k) => (
                      <li key={k} className="flex justify-between gap-3">
                        <span>
                          {i.code ? <span className="text-muted">{i.code}. </span> : null}
                          {i.name}
                          {i.aliases?.length ? (
                            <span className="text-xs text-muted"> · {i.aliases.join(", ")}</span>
                          ) : null}
                        </span>
                        <span className="tabular-nums">{formatChf(i.priceCents)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={replace}
                onChange={(e) => setReplace(e.target.checked)}
                className="accent-brand-600"
              />
              Replace the existing menu (otherwise items are added)
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Back
              </Button>
              <Button onClick={doImport} disabled={pending}>
                {pending ? "Importing…" : `Import ${itemCount} items`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
