"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted">
        {error.message || "An unexpected error occurred."}
      </p>
      {error.digest ? (
        <p className="font-mono text-xs text-muted">Reference: {error.digest}</p>
      ) : null}
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
