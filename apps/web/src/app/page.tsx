import { redirect } from "next/navigation";
import { getCurrentUser, listAccessibleRestaurants } from "@/server/session";
import { userCount } from "@/server/users";
import { Logo } from "@/components/logo";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function Home() {
  if ((await userCount()) === 0) redirect("/setup");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role === "admin") redirect("/admin");
  const list = await listAccessibleRestaurants(user);
  if (list.length === 1) redirect(`/r/${list[0]!.slug}/orders`);
  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <Logo />
      <h1 className="mt-8 text-xl font-semibold">Ihre Restaurants</h1>
      {list.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          Ihr Konto ist noch keinem Restaurant zugeordnet. Bitte wenden Sie sich an JustCall.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-[var(--border)] rounded-xl border border-default surface">
          {list.map((r) => (
            <li key={r.id}>
              <Link
                href={`/r/${r.slug}/orders`}
                className="block px-4 py-3 hover:bg-[var(--surface-muted)]"
              >
                {r.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
