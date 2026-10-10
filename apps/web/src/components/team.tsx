"use client";

import { Copy, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  inviteUser,
  removeMember,
  revokeInvitation,
  setMemberRole,
  setPlatformRole,
} from "@/server/actions/team";

export function InviteForm({
  restaurantId,
  roles,
}: {
  restaurantId: string | null;
  roles: { value: string; label: string }[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState(roles[0]!.value);
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await inviteUser(restaurantId, { email, role });
            if (res?.error) return void toast.error(res.error);
            toast.success(res?.message ?? "Invited");
            setLink((res?.data as { link: string }).link);
            setEmail("");
            router.refresh();
          });
        }}
      >
        <Input
          type="email"
          required
          placeholder="name@restaurant.ch"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-64"
        />
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-40">
          {roles.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={pending}>
          <UserPlus /> Invite
        </Button>
      </form>
      {link ? (
        <div className="flex items-center gap-2 rounded-lg border border-default bg-[var(--surface-muted)] p-2 text-xs">
          <span className="truncate font-mono">{link}</span>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(link);
              toast.success("Link copied");
            }}
          >
            <Copy /> Copy
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function MemberActions({
  restaurantId,
  userId,
  role,
}: {
  restaurantId: string;
  userId: string;
  role: "owner" | "staff";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; message?: string } | undefined>) =>
    start(async () => {
      const res = await fn();
      if (res?.error) toast.error(res.error);
      else {
        toast.success(res?.message ?? "Done");
        router.refresh();
      }
    });
  return (
    <div className="flex gap-1">
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          run(() => setMemberRole(restaurantId, userId, role === "owner" ? "staff" : "owner"))
        }
      >
        Make {role === "owner" ? "staff" : "owner"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() =>
          confirm("Remove access for this person?") && run(() => removeMember(restaurantId, userId))
        }
      >
        Remove
      </Button>
    </div>
  );
}

export function RevokeInviteButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          await revokeInvitation(id);
          router.refresh();
        })
      }
    >
      Revoke
    </Button>
  );
}

export function PlatformRoleButton({ userId, role }: { userId: string; role: "admin" | "member" }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        confirm(role === "admin" ? "Remove admin rights?" : "Grant full admin rights?") &&
        start(async () => {
          const res = await setPlatformRole(userId, role === "admin" ? "member" : "admin");
          if (res?.error) toast.error(res.error);
          else toast.success(res?.message ?? "Updated");
          router.refresh();
        })
      }
    >
      {role === "admin" ? "Revoke admin" : "Make admin"}
    </Button>
  );
}
