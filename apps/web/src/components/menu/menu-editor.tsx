"use client";

import { MenuIndex, formatChf, type MenuSnapshot } from "@justcall/core";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FolderPlus,
  Layers,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import {
  deleteCategory,
  deleteItem,
  deleteOptionGroup,
  exportMenuAction,
  moveCategory,
  moveItem,
  setItemAvailability,
} from "@/server/actions/menu";
import { CategoryDialog, GroupDialog, ItemDialog } from "./dialogs";
import { ImportDialog } from "./import-dialog";
import type { EditorCategory, EditorData, EditorGroup, EditorItem } from "./types";

type DialogState =
  | { kind: "item"; item: EditorItem | null; categoryId?: string | null }
  | { kind: "category"; category: EditorCategory | null }
  | { kind: "group"; group: EditorGroup | null }
  | { kind: "import" }
  | null;

export function MenuEditor({
  restaurantId,
  data,
  aiAvailable,
}: {
  restaurantId: string;
  data: EditorData;
  aiAvailable: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<DialogState>(null);
  const [filter, setFilter] = useState("");
  const [pending, start] = useTransition();
  const groupName = useMemo(() => new Map(data.groups.map((g) => [g.id, g])), [data.groups]);

  const act = (
    fn: () => Promise<{ ok?: boolean; error?: string; message?: string } | undefined>,
    confirmText?: string,
  ) => {
    if (confirmText && !confirm(confirmText)) return;
    start(async () => {
      const res = await fn();
      if (res?.error) toast.error(res.error);
      else {
        if (res?.message && res.message !== "Order updated") toast.success(res.message);
        router.refresh();
      }
    });
  };

  const exportJson = () =>
    start(async () => {
      const menu = await exportMenuAction(restaurantId);
      const blob = new Blob([JSON.stringify(menu, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "menu.json";
      a.click();
      URL.revokeObjectURL(a.href);
    });

  const q = filter.trim().toLowerCase();
  const visibleItems = (categoryId: string | null) =>
    data.items
      .filter((i) => i.categoryId === categoryId)
      .filter(
        (i) => !q || [i.name, i.code ?? "", ...i.aliases].some((s) => s.toLowerCase().includes(q)),
      )
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const sections = [
    ...data.categories
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((c) => ({ category: c as EditorCategory | null, items: visibleItems(c.id) })),
    { category: null, items: visibleItems(null) },
  ].filter((s) => s.category || s.items.length);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => setDialog({ kind: "item", item: null })}
          disabled={!data.categories.length && !data.items.length ? false : undefined}
        >
          <Plus /> Add item
        </Button>
        <Button variant="secondary" onClick={() => setDialog({ kind: "category", category: null })}>
          <FolderPlus /> Add category
        </Button>
        <Button variant="secondary" onClick={() => setDialog({ kind: "group", group: null })}>
          <Layers /> Add option group
        </Button>
        <Button variant="secondary" onClick={() => setDialog({ kind: "import" })}>
          <Upload /> Import
        </Button>
        <Button variant="ghost" onClick={exportJson} disabled={pending}>
          <Download /> Export
        </Button>
        <div className="relative ml-auto w-full sm:w-64">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter items…"
            className="pl-8"
          />
        </div>
      </div>

      <MatchTester data={data} />

      {sections.length === 0 ? (
        <Card>
          <EmptyState icon={<Layers />} title="The menu is empty">
            Add categories and items, or import an existing menu (AI from text/photo, CSV or JSON).
          </EmptyState>
        </Card>
      ) : (
        sections.map(({ category, items }) => (
          <Card key={category?.id ?? "none"}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {category?.name ?? "Uncategorised"}
                  {category && !category.isActive ? <Badge>Hidden</Badge> : null}
                  <span className="text-sm font-normal text-muted">{items.length} items</span>
                </span>
              }
              description={category?.description ?? undefined}
              actions={
                category ? (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => act(() => moveCategory(restaurantId, category.id, -1))}
                      aria-label="Move up"
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => act(() => moveCategory(restaurantId, category.id, 1))}
                      aria-label="Move down"
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDialog({ kind: "category", category })}
                    >
                      <Pencil /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDialog({ kind: "item", item: null, categoryId: category.id })
                      }
                    >
                      <Plus /> Item
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label="Delete category"
                      onClick={() =>
                        act(
                          () => deleteCategory(restaurantId, category.id),
                          `Delete category "${category.name}"? Its items stay (uncategorised).`,
                        )
                      }
                    >
                      <Trash2 />
                    </Button>
                  </>
                ) : null
              }
            />
            {items.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">No items in this category.</p>
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {items.map((item, idx) => (
                  <li
                    key={item.id}
                    className={`flex flex-wrap items-center gap-3 px-5 py-3 ${!item.isActive ? "opacity-50" : ""}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {item.code ? (
                          <span className="rounded bg-[var(--surface-muted)] px-1.5 text-xs font-medium text-muted">
                            {item.code}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setDialog({ kind: "item", item })}
                          className="font-medium hover:underline"
                        >
                          {item.name}
                        </button>
                        {!item.isAvailable ? <Badge tone="red">Sold out</Badge> : null}
                        {!item.isActive ? <Badge>Hidden</Badge> : null}
                        {item.tags.map((t) => (
                          <Badge key={t} tone="neutral">
                            {t}
                          </Badge>
                        ))}
                      </div>
                      {item.aliases.length ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {item.aliases.map((a) => (
                            <span
                              key={a}
                              className="rounded-md bg-brand-50 px-1.5 py-0.5 text-xs text-brand-800 dark:bg-brand-950 dark:text-brand-200"
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {item.groupIds.length ? (
                        <div className="mt-1 text-xs text-muted">
                          Options:{" "}
                          {item.groupIds
                            .map((g) => groupName.get(g)?.name)
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      ) : null}
                    </div>
                    <div className="w-24 text-right font-medium tabular-nums">
                      {formatChf(item.priceCents)}
                    </div>
                    <label
                      className="flex items-center gap-2 text-xs text-muted"
                      title="Available today"
                    >
                      <input
                        type="checkbox"
                        checked={item.isAvailable}
                        onChange={(e) =>
                          act(() => setItemAvailability(restaurantId, item.id, e.target.checked))
                        }
                        className="size-4 accent-brand-600"
                      />
                      Available
                    </label>
                    <div className="flex items-center">
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={idx === 0}
                        onClick={() => act(() => moveItem(restaurantId, item.id, -1))}
                        aria-label="Move up"
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={idx === items.length - 1}
                        onClick={() => act(() => moveItem(restaurantId, item.id, 1))}
                        aria-label="Move down"
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDialog({ kind: "item", item })}
                        aria-label="Edit"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          act(() => deleteItem(restaurantId, item.id), `Delete "${item.name}"?`)
                        }
                        aria-label="Delete"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))
      )}

      <Card>
        <CardHeader
          title="Option groups"
          description="Sizes, sauces, extras and menu drinks. Attach groups to items in the item dialog. * = required choice."
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setDialog({ kind: "group", group: null })}
            >
              <Plus /> New group
            </Button>
          }
        />
        {data.groups.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted">No option groups yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {data.groups.map((g) => {
              const used = data.items.filter((i) => i.groupIds.includes(g.id)).length;
              return (
                <li key={g.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {g.name}
                      {g.minSelect > 0 ? " *" : ""}{" "}
                      <span className="text-xs font-normal text-muted">
                        {g.minSelect > 0
                          ? `choose ${g.minSelect === g.maxSelect ? g.minSelect : `${g.minSelect}–${g.maxSelect}`}`
                          : `optional, up to ${g.maxSelect}`}{" "}
                        · used by {used} items
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                      {g.options.map((o) => (
                        <span
                          key={o.id}
                          className={`rounded-md border border-default px-1.5 py-0.5 ${!o.isAvailable ? "line-through opacity-60" : ""}`}
                        >
                          {o.name}
                          {o.priceDeltaCents
                            ? ` +${formatChf(o.priceDeltaCents, { withCurrency: false })}`
                            : ""}
                          {o.isDefault ? " (default)" : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDialog({ kind: "group", group: g })}
                  >
                    <Pencil /> Edit
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete group"
                    onClick={() =>
                      act(
                        () => deleteOptionGroup(restaurantId, g.id),
                        `Delete option group "${g.name}"?`,
                      )
                    }
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {dialog?.kind === "item" ? (
        <ItemDialog
          key={dialog.item?.id ?? "new"}
          restaurantId={restaurantId}
          data={data}
          item={dialog.item}
          defaultCategoryId={dialog.categoryId}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "category" ? (
        <CategoryDialog
          restaurantId={restaurantId}
          category={dialog.category}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "group" ? (
        <GroupDialog
          restaurantId={restaurantId}
          group={dialog.group}
          open
          onOpenChange={(o) => !o && setDialog(null)}
        />
      ) : null}
      {dialog?.kind === "import" ? (
        <ImportDialog
          restaurantId={restaurantId}
          open
          aiAvailable={aiAvailable}
          onOpenChange={(o) => !o && setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/** Live check of what the assistant would understand for a phrase (uses the same matcher as calls). */
function MatchTester({ data }: { data: EditorData }) {
  const [query, setQuery] = useState("");
  const index = useMemo(() => {
    const snapshot: MenuSnapshot = {
      categories: data.categories.filter((c) => c.isActive),
      groups: data.groups,
      items: data.items.filter((i) => i.isActive),
    };
    return new MenuIndex(snapshot);
  }, [data]);
  const result = query.trim() ? index.matchItem(query) : null;
  return (
    <Card>
      <CardBody className="flex flex-wrap items-center gap-3 py-4">
        <div className="text-sm font-medium">Test what callers might say</div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='e.g. "combo drü", "e Margarita", "Nummer 5"'
          className="max-w-xs"
        />
        <div className="text-sm">
          {!result ? (
            <span className="text-muted">
              The assistant resolves names, aliases, codes and typos the same way.
            </span>
          ) : result.status === "exact" || result.status === "confident" ? (
            <span>
              →{" "}
              <span className="font-medium text-emerald-700 dark:text-emerald-400">
                {result.item.name}
              </span>
              {result.candidates[0] && result.candidates[0].matchedName !== result.item.name ? (
                <span className="text-muted"> (via “{result.candidates[0].matchedName}”)</span>
              ) : null}
              {!result.item.isAvailable ? <span className="text-red-600"> – sold out</span> : null}
            </span>
          ) : result.status === "ambiguous" ? (
            <span className="text-amber-700 dark:text-amber-400">
              Ambiguous – the assistant will ask:{" "}
              {result.candidates.map((c) => c.item.name).join(" / ")}
            </span>
          ) : (
            <span className="text-red-600">
              Not recognised
              {result.candidates.length ? ` (closest: ${result.candidates[0]!.item.name})` : ""} –
              consider adding an alias.
            </span>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
