"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { Button, type ButtonProps } from "@/components/ui/button";

export type ActionResult =
  { ok?: boolean; error?: string; message?: string; data?: unknown } | undefined;
type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

/** Form bound to a server action with toast feedback. */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  onSuccess,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  onSuccess?: (result: ActionResult) => void;
}) {
  const [state, formAction] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!state) return;
    if (state.error) toast.error(state.error);
    else if (state.ok) {
      toast.success(state.message ?? "Saved");
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
    </form>
  );
}

export function SubmitButton({ children = "Save", ...props }: ButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} {...props}>
      {pending ? "Saving…" : children}
    </Button>
  );
}
