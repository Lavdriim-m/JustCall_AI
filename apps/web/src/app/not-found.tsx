import Link from "next/link";
import { Logo } from "@/components/logo";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <Logo />
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">The page does not exist or you do not have access to it.</p>
      <Link href="/" className="text-brand-700 underline dark:text-brand-300">
        Go to the start page
      </Link>
    </div>
  );
}
