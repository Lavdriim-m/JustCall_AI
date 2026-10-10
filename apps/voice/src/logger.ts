import pino from "pino";

export function createLogger(level = process.env.LOG_LEVEL ?? "info") {
  const pretty = process.env.NODE_ENV !== "production" && process.stdout.isTTY;
  return pino({
    level,
    base: { service: "voice" },
    redact: { paths: ["req.headers.authorization", "*.apiKey", "*.authToken"], remove: true },
    transport: pretty
      ? {
          target: "pino-pretty",
          options: { translateTime: "SYS:HH:MM:ss", ignore: "pid,hostname,service" },
        }
      : undefined,
  });
}

export type Logger = pino.Logger;
