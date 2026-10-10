import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

const here = path.dirname(fileURLToPath(import.meta.url));
// Monorepo: share the repository root .env with the voice server during local development.
loadEnv({ path: path.join(here, "../../.env"), quiet: true });

const nextConfig: NextConfig = {
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  outputFileTracingRoot: path.join(here, "../.."),
  transpilePackages: ["@justcall/core", "@justcall/db", "@justcall/services"],
  // PDF generation reads font metrics from disk – keep these packages unbundled.
  serverExternalPackages: ["pdfkit", "swissqrbill", "postgres", "twilio", "nodemailer"],
  poweredByHeader: false,
  // Menu photos for the AI import are sent through a server action.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  agentRules: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
        ],
      },
    ];
  },
};

export default nextConfig;
