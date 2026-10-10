"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { acceptInvitation } from "@/server/actions/auth";

export function InviteForm({
  token,
  email,
  existing,
}: {
  token: string;
  email: string;
  existing: boolean;
}) {
  const [state, action, pending] = useActionState(acceptInvitation.bind(null, token), undefined);
  return (
    <form action={action} className="space-y-4">
      <Field label="Email">
        <Input value={email} disabled readOnly />
      </Field>
      {existing ? (
        <p className="text-sm text-muted">
          You already have an account. Accept to get access with your existing password.
        </p>
      ) : (
        <>
          <Field label="Your name" htmlFor="name">
            <Input id="name" name="name" required autoFocus />
          </Field>
          <Field label="Password" htmlFor="password" hint="At least 10 characters.">
            <Input
              id="password"
              name="password"
              type="password"
              minLength={10}
              required
              autoComplete="new-password"
            />
          </Field>
        </>
      )}
      {state?.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        Accept invitation
      </Button>
    </form>
  );
}
