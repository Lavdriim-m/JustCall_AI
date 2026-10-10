import { redirect } from "next/navigation";
import { userCount } from "@/server/users";
import { SetupForm } from "./setup-form";

export const metadata = { title: "Setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if ((await userCount()) > 0) redirect("/login");
  return (
    <>
      <h1 className="text-lg font-semibold">Welcome to JustCall</h1>
      <p className="mb-5 mt-1 text-sm text-muted">
        Create the administrator account. This page is only available once.
      </p>
      <SetupForm />
    </>
  );
}
