/**
 * Central pino logger. Prefer `childLogger({ area: "oauth" })` at route entry
 * so every log from that handler carries the area. Never log tokens, codes,
 * or DSNs — the `redact` list covers the common cases but new fields require
 * adding here.
 */
import pino from "pino";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const level =
  process.env.LOG_LEVEL ??
  (process.env.NODE_ENV === "production" ? "info" : "debug");

/**
 * Return a pretty transport config only when pino-pretty is installed and
 * pretty output is wanted (LOG_PRETTY=1 or dev NODE_ENV). pino-pretty is a
 * devDep so production installs (npm ci --omit=dev, Next.js standalone
 * tracing) may not have it — without this guard, pino crashes at startup.
 */
function prettyTransport():
  | { target: string; options: Record<string, unknown> }
  | undefined {
  const explicit = process.env.LOG_PRETTY;
  if (explicit === "0") return undefined;
  if (explicit !== "1" && process.env.NODE_ENV === "production") return undefined;
  try {
    require.resolve("pino-pretty");
  } catch {
    return undefined;
  }
  return {
    target: "pino-pretty",
    options: { colorize: true, translateTime: "SYS:HH:MM:ss" },
  };
}

export const logger = pino({
  level,
  base: { service: "aju" },
  // Redact common secret-bearing fields in any log object.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "headers.authorization",
      "headers.cookie",
      "authorization",
      "clientSecret",
      "client_secret",
      "refreshToken",
      "refresh_token",
      "accessToken",
      "access_token",
      "code",
      "password",
      "apiKey",
      "api_key",
      "dsn",
      "databaseUrl",
      "DATABASE_URL",
    ],
    censor: "[redacted]",
  },
  // Pretty only when safe; production gets structured JSON.
  transport: prettyTransport(),
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
