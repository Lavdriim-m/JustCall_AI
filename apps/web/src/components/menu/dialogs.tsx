"use client";

import { Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ChipsInput } from "@/components/ui/chips-input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { saveCategory, saveItem, saveOptionGroup } from "@/server/actions/menu";
import {
  centsToInput,
  inputToCents,
  type EditorCategory,
  type EditorData,
  type EditorGroup,
  type EditorItem,
} from "./types";

const TAG_SUGGESTIONS = ["vegetarisch", "vegan", "scharf", "neu", "beliebt"];

type ActionRes = { ok?: boolean; error?: string; message?: string } | undefined;

function useSave(onDone: () => void) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<ActionRes>) =>
    start(async () => {
      const res = await fn();
      if (res?.error) toast.error(res.error);
      else {
        if (res?.message?.includes("warning")) toast.warning(res.message, { duration: 8000 });
        else toast.success(res?.message ?? "Saved");
        router.refresh();
        onDone();
      }
    });
  return { pending, run };
}

/* ---------------------------------------------------------------------------- */

export function ItemDialog({
  restaurantId,
  data,
  item,
  defaultCategoryId,
  open,
  onOpenChange,
}: {
  restaurantId: string;
  data: EditorData;
  item: EditorItem | null;
  defaultCategoryId?: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState(item?.name ?? "");
  const [price, setPrice] = useState(item ? centsToInput(item.priceCents) : "");
  const [categoryId, setCategoryId] = useState<string>(
    item?.categoryId ?? defaultCategoryId ?? data.categories[0]?.id ?? "",
  );
  const [code, setCode] = useState(item?.code ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [aliases, setAliases] = useState<string[]>(item?.aliases ?? []);
  const [tags, setTags] = useState<string[]>(item?.tags ?? []);
  const [allergens, setAllergens] = useState<string[]>(item?.allergens ?? []);
  const [groupIds, setGroupIds] = useState<string[]>(item?.groupIds ?? []);
  const [isAvailable, setAvailable] = useState(item?.isAvailable ?? true);
  const [isActive, setActive] = useState(item?.isActive ?? true);
  const { pending, run } = useSave(() => onOpenChange(false));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const priceCents = inputToCents(price);
    if (priceCents === null) return toast.error("Invalid price");
    run(() =>
      saveItem(restaurantId, {
        id: item?.id,
        categoryId: categoryId || null,
        name,
        description: description || null,
        code: code || null,
        aliases,
        priceCents,
        tags,
        allergens,
        isAvailable,
        isActive,
        groupIds,
      }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={item ? `Edit ${item.name}` : "New item"} wide>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-6">
          <Field label="Name" htmlFor="item-name" className="sm:col-span-4">
            <Input
              id="item-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label="Price (CHF)" htmlFor="item-price" className="sm:col-span-2">
            <Input
              id="item-price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="18.50"
              required
            />
          </Field>
          <Field label="Category" htmlFor="item-category" className="sm:col-span-3">
            <Select
              id="item-category"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">– No category –</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Menu number / code"
            htmlFor="item-code"
            className="sm:col-span-3"
            hint='Callers can say "Nummer 3".'
          >
            <Input
              id="item-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="3"
            />
          </Field>
          <Field
            label="Other names for this item (aliases)"
            htmlFor="item-aliases"
            className="sm:col-span-6"
            hint='Everything callers might say for the same item, e.g. "Combo 3", "Napoli", "Menü 3". Press Enter after each.'
          >
            <ChipsInput
              id="item-aliases"
              value={aliases}
              onChange={setAliases}
              placeholder="Combo 3, Napoli …"
            />
          </Field>
          <Field
            label="Description / ingredients"
            htmlFor="item-desc"
            className="sm:col-span-6"
            hint="The assistant uses this to answer questions about the dish."
          >
            <Textarea
              id="item-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </Field>
          <Field
            label="Option groups"
            className="sm:col-span-6"
            hint="Sizes, sauces, extras … Manage groups below the menu."
          >
            {data.groups.length === 0 ? (
              <p className="text-sm text-muted">No option groups yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.groups.map((g) => {
                  const on = groupIds.includes(g.id);
                  return (
                    <button
                      type="button"
                      key={g.id}
                      onClick={() =>
                        setGroupIds(on ? groupIds.filter((x) => x !== g.id) : [...groupIds, g.id])
                      }
                      className={`rounded-lg border px-3 py-1.5 text-sm ${on ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200" : "border-default text-muted"}`}
                    >
                      {g.name}
                      {g.minSelect > 0 ? " *" : ""}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
          <Field
            label="Tags"
            className="sm:col-span-3"
            hint={`Suggestions: ${TAG_SUGGESTIONS.join(", ")}`}
          >
            <ChipsInput value={tags} onChange={setTags} placeholder="vegetarisch" />
          </Field>
          <Field
            label="Allergens (info only)"
            className="sm:col-span-3"
            hint="Shown to staff. The assistant never gives allergen advice."
          >
            <ChipsInput value={allergens} onChange={setAllergens} placeholder="Gluten, Milch" />
          </Field>
          <div className="flex flex-wrap gap-6 sm:col-span-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isAvailable}
                onChange={(e) => setAvailable(e.target.checked)}
                className="accent-brand-600"
              />
              Available (uncheck = sold out today)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setActive(e.target.checked)}
                className="accent-brand-600"
              />
              Visible on the menu
            </label>
          </div>
          <div className="flex justify-end gap-2 sm:col-span-6">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------- */

export function CategoryDialog({
  restaurantId,
  category,
  open,
  onOpenChange,
}: {
  restaurantId: string;
  category: EditorCategory | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [isActive, setActive] = useState(category?.isActive ?? true);
  const { pending, run } = useSave(() => onOpenChange(false));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={category ? "Edit category" : "New category"}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() =>
              saveCategory(restaurantId, {
                id: category?.id,
                name,
                description: description || null,
                isActive,
              }),
            );
          }}
          className="space-y-4"
        >
          <Field label="Name" htmlFor="cat-name">
            <Input
              id="cat-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              placeholder="Pizza"
            />
          </Field>
          <Field label="Description" htmlFor="cat-desc">
            <Input
              id="cat-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setActive(e.target.checked)}
              className="accent-brand-600"
            />
            Visible (hidden categories and their items are not offered by the assistant)
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------------------------------------------------------------------- */

type DraftOption = {
  id?: string;
  name: string;
  price: string;
  aliases: string[];
  isDefault: boolean;
  isAvailable: boolean;
};

export function GroupDialog({
  restaurantId,
  group,
  open,
  onOpenChange,
}: {
  restaurantId: string;
  group: EditorGroup | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [name, setName] = useState(group?.name ?? "");
  const [minSelect, setMin] = useState(group?.minSelect ?? 0);
  const [maxSelect, setMax] = useState(group?.maxSelect ?? 1);
  const [opts, setOpts] = useState<DraftOption[]>(
    group?.options.map((o) => ({
      id: o.id,
      name: o.name,
      price: centsToInput(o.priceDeltaCents),
      aliases: o.aliases,
      isDefault: o.isDefault,
      isAvailable: o.isAvailable,
    })) ?? [{ name: "", price: "0.00", aliases: [], isDefault: false, isAvailable: true }],
  );
  const { pending, run } = useSave(() => onOpenChange(false));
  const update = (i: number, patch: Partial<DraftOption>) =>
    setOpts((all) => all.map((o, j) => (j === i ? { ...o, ...patch } : o)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const options: {
      id?: string;
      name: string;
      priceDeltaCents: number;
      aliases: string[];
      isDefault: boolean;
      isAvailable: boolean;
    }[] = [];
    for (const o of opts) {
      if (!o.name.trim()) continue;
      const cents = inputToCents(o.price);
      if (cents === null) return toast.error(`Invalid price for ${o.name}`);
      options.push({
        id: o.id,
        name: o.name,
        priceDeltaCents: cents,
        aliases: o.aliases,
        isDefault: o.isDefault,
        isAvailable: o.isAvailable,
      });
    }
    run(() =>
      saveOptionGroup(restaurantId, { id: group?.id, name, minSelect, maxSelect, options }),
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={group ? `Edit ${group.name}` : "New option group"}
        description="e.g. Size (required, choose 1), Extras (optional, up to 5), Drink for menus (required, choose 1)."
        wide
      >
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Group name" htmlFor="grp-name" className="sm:col-span-2">
              <Input
                id="grp-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                placeholder="Grösse"
                autoFocus
              />
            </Field>
            <Field label="Customer must choose at least" htmlFor="grp-min" hint="0 = optional">
              <Input
                id="grp-min"
                type="number"
                min={0}
                value={minSelect}
                onChange={(e) => setMin(Number(e.target.value))}
              />
            </Field>
            <Field label="At most" htmlFor="grp-max">
              <Input
                id="grp-max"
                type="number"
                min={1}
                value={maxSelect}
                onChange={(e) => setMax(Number(e.target.value))}
              />
            </Field>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted">
              <div className="col-span-3">Option</div>
              <div className="col-span-2">Surcharge (CHF)</div>
              <div className="col-span-4">Other names</div>
              <div className="col-span-3">Default / available</div>
            </div>
            {opts.map((o, i) => (
              <div key={o.id ?? `new-${i}`} className="grid grid-cols-12 items-center gap-2">
                <Input
                  className="col-span-3"
                  value={o.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  placeholder="Gross"
                />
                <Input
                  className="col-span-2"
                  value={o.price}
                  onChange={(e) => update(i, { price: e.target.value })}
                  inputMode="decimal"
                />
                <ChipsInput
                  className="col-span-4"
                  value={o.aliases}
                  onChange={(aliases) => update(i, { aliases })}
                  placeholder="Family"
                />
                <div className="col-span-3 flex items-center gap-3 text-xs">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={o.isDefault}
                      onChange={(e) => update(i, { isDefault: e.target.checked })}
                      className="accent-brand-600"
                    />
                    Default
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={o.isAvailable}
                      onChange={(e) => update(i, { isAvailable: e.target.checked })}
                      className="accent-brand-600"
                    />
                    Avail.
                  </label>
                  <button
                    type="button"
                    onClick={() => setOpts((all) => all.filter((_, j) => j !== i))}
                    className="ml-auto text-muted hover:text-red-600"
                    aria-label="Remove option"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                setOpts((all) => [
                  ...all,
                  { name: "", price: "0.00", aliases: [], isDefault: false, isAvailable: true },
                ])
              }
            >
              <Plus /> Add option
            </Button>
          </div>
          <p className="text-xs text-muted">
            Tip: mark a default for required groups (e.g. size &quot;Normal&quot;) – the assistant
            then only asks when the caller wants something else.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save group
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
