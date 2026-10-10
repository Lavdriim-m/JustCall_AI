import "server-only";
import { account, getDb, session, user, verification } from "@justcall/db";
import { sendMail } from "@justcall/services";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { env } from "@/lib/env";

function createAuth() {
  return betterAuth({
    appName: "JustCall",
    baseURL: env.appUrl,
    secret: env.authSecret,
    trustedOrigins: [env.appUrl],
    database: drizzleAdapter(getDb(), {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      // Accounts are created by invitation only (see /invite/[token]) or by the first-run setup.
      disableSignUp: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: u, url }) => {
        await sendMail({
          to: u.email,
          subject: "JustCall – Passwort zurücksetzen",
          text: `Hallo ${u.name}\n\nÜber diesen Link können Sie ein neues Passwort festlegen (gültig für 1 Stunde):\n${url}\n\nFalls Sie das nicht angefordert haben, ignorieren Sie diese E-Mail.\n\nJustCall`,
        });
      },
    },
    user: {
      additionalFields: {
        role: { type: "string", required: false, defaultValue: "member", input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 * 5 },
    },
    rateLimit: { enabled: true, window: 60, max: 60, storage: "memory" },
    advanced: {
      useSecureCookies: env.appUrl.startsWith("https://"),
      cookiePrefix: "justcall",
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __justcallAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__justcallAuth ??= createAuth();
  return globalForAuth.__justcallAuth;
}
