"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [error, setError] = useState<string | null>(
    params.get("error") ? "The link is invalid or expired." : null,
  );
  const [pending, setPending] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    const password = String(new FormData(e.currentTarget).get("password"));
    setPending(true);
    const res = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (res.error) setError(res.error.message ?? "Could not reset the password.");
    else router.replace("/login?reset=1");
  }
  return (
    <form onSubmit={onSubmit} className="mt-5 space-y-4">
      <Field label="New password" htmlFor="password" hint="At least 10 characters.">
        <Input
          id="password"
          name="password"
          type="password"
          minLength={10}
          required
          autoComplete="new-password"
        />
      </Field>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={pending || !token}>
        Set new password
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-lg font-semibold">Choose a new password</h1>
      <Suspense>
        <ResetForm />
      </Suspense>
    </>
  );
}
