import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

export type FilterField =
  | { type: "select"; name: string; label: string; options: { value: string; label: string }[] }
  | { type: "date"; name: string; label: string }
  | { type: "text"; name: string; label: string; placeholder?: string }
  | { type: "checkbox"; name: string; label: string };

/** GET form that writes filters into the URL (works without JavaScript). */
export function Filters({
  fields,
  values,
  action,
}: {
  fields: FilterField[];
  values: Record<string, string | undefined>;
  action: string;
}) {
  return (
    <form
      action={action}
      method="get"
      className="flex flex-wrap items-end gap-3 border-b border-default px-5 py-3"
    >
      {fields.map((f) => (
        <label key={f.name} className="space-y-1 text-xs text-muted">
          <span className="block">{f.label}</span>
          {f.type === "select" ? (
            <Select name={f.name} defaultValue={values[f.name] ?? ""} className="h-8 w-44 text-sm">
              <option value="">All</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          ) : f.type === "checkbox" ? (
            <span className="flex h-8 items-center gap-2 text-sm text-[var(--text)]">
              <input
                type="checkbox"
                name={f.name}
                value="1"
                defaultChecked={values[f.name] === "1"}
                className="accent-brand-600"
              />
            </span>
          ) : (
            <Input
              type={f.type}
              name={f.name}
              defaultValue={values[f.name] ?? ""}
              placeholder={f.type === "text" ? f.placeholder : undefined}
              className="h-8 w-40 text-sm"
            />
          )}
        </label>
      ))}
      <Button type="submit" size="sm">
        Apply
      </Button>
      <Button asChild size="sm" variant="ghost">
        <Link href={action}>Reset</Link>
      </Button>
    </form>
  );
}

export function Pagination({
  page,
  hasMore,
  base,
  params,
}: {
  page: number;
  hasMore: boolean;
  base: string;
  params: Record<string, string | undefined>;
}) {
  const href = (p: number) => {
    const sp = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v) as [string, string][],
    );
    sp.set("page", String(p));
    return `${base}?${sp.toString()}`;
  };
  if (page === 1 && !hasMore) return null;
  return (
    <div className="flex items-center justify-between border-t border-default px-5 py-3 text-sm">
      <span className="text-muted">Page {page}</span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button asChild size="sm" variant="secondary">
            <Link href={href(page - 1)}>Previous</Link>
          </Button>
        ) : null}
        {hasMore ? (
          <Button asChild size="sm" variant="secondary">
            <Link href={href(page + 1)}>Next</Link>
          </Button>
        ) : null}
      </div>
    </div>
  );
}
