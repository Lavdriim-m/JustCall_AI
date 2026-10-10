import "server-only";

/** Server-side configuration. Values are read lazily so `next build` works without secrets. */
export const env = {
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get voiceUrl() {
    return (process.env.VOICE_PUBLIC_URL ?? "http://localhost:8080").replace(/\/$/, "");
  },
  /** Voice server URL used for server-to-server calls (defaults to the public URL). */
  get voiceInternalUrl() {
    return (
      process.env.VOICE_INTERNAL_URL ??
      process.env.VOICE_PUBLIC_URL ??
      "http://localhost:8080"
    ).replace(/\/$/, "");
  },
  get internalSecret() {
    return requiredInProduction("INTERNAL_API_SECRET", "dev-secret-change-me-please");
  },
  get authSecret() {
    return requiredInProduction(
      "BETTER_AUTH_SECRET",
      "dev-auth-secret-change-me-please-0123456789",
    );
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
};

/** Development falls back to a fixed value; production refuses to run with a missing secret. */
function requiredInProduction(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value) return value;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    throw new Error(`${name} must be set in production (see .env.example).`);
  }
  return devFallback;
}
