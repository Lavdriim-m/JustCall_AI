"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    await authClient.requestPasswordReset({
      email: String(new FormData(e.currentTarget).get("email")),
      redirectTo: "/reset-password",
    });
    setPending(false);
    setSent(true);
  }
  return (
    <>
      <h1 className="text-lg font-semibold">Reset password</h1>
      {sent ? (
        <p className="mt-3 text-sm text-muted">
          If an account exists for this address, we sent a link to reset the password.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" required autoFocus />
          </Field>
          <Button type="submit" className="w-full" disabled={pending}>
            Send reset link
          </Button>
        </form>
      )}
      <div className="mt-4 text-center">
        <Link href="/login" className="text-sm text-muted hover:underline">
          Back to sign in
        </Link>
      </div>
    </>
  );
}
