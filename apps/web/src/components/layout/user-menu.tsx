import { LogOut } from "lucide-react";
import { signOutAction } from "@/server/actions/auth";
import type { CurrentUser } from "@/server/session";

export function UserMenu({ user }: { user: CurrentUser }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-default p-2">
      <div className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800 dark:bg-brand-900 dark:text-brand-100">
        {user.name.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{user.name}</div>
        <div className="truncate text-xs text-muted">{user.email}</div>
      </div>
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-md p-1.5 text-muted hover:bg-[var(--surface-muted)]"
          title="Sign out"
          aria-label="Sign out"
        >
          <LogOut className="size-4" />
        </button>
      </form>
    </div>
  );
}
