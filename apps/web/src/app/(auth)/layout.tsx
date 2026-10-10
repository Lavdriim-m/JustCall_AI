import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="mb-8">
        <Logo />
      </div>
      <div className="w-full max-w-sm rounded-xl border border-default surface p-6 shadow-sm">
        {children}
      </div>
      <p className="mt-6 text-xs text-muted">
        AI phone ordering for restaurants · Made in Switzerland
      </p>
    </div>
  );
}
