import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";
import { userCount } from "@/server/users";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ invited?: string; reset?: string }>;
}) {
  if ((await userCount()) === 0) redirect("/setup");
  if (await getCurrentUser()) redirect("/");
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-lg font-semibold">Sign in</h1>
      <p className="mb-5 mt-1 text-sm text-muted">Welcome back to JustCall.</p>
      {sp.invited ? (
        <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Invitation accepted – sign in with your existing password.
        </p>
      ) : null}
      {sp.reset ? (
        <p className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Password updated. Please sign in.
        </p>
      ) : null}
      <LoginForm />
    </>
  );
}
