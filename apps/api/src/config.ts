import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  API_BASE_URL: z.string().url().default("http://localhost:4000"),
  TRUSTED_PROXY_IPS: z.string().default(""),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "Expected a PostgreSQL URL",
    ),
  REDIS_URL: z.string().url().optional(),
  AUTH_SECRET: z.string().min(32),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  MAX_EVENT_PAYLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(1_000_000)
    .default(32_768),
  MAX_BATCH_EVENTS: z.coerce.number().int().min(1).max(100).default(100),
  TELEMETRY_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(3650)
    .default(14),
  INGEST_RATE_LIMIT_PER_MINUTE: z.coerce
    .number()
    .int()
    .min(1)
    .max(100_000)
    .default(600),
  INVESTIGATION_RATE_LIMIT_PER_HOUR: z.coerce
    .number()
    .int()
    .min(1)
    .max(10_000)
    .default(20),
  VERIFICATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(300_000)
    .default(60_000),
  VERIFICATION_MAX_OUTPUT_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(1_000_000)
    .default(65_536),
});

const parsed = configSchema.safeParse(process.env);
if (!parsed.success) {
  const detail = parsed.error.issues
    .map(
      (issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`,
    )
    .join("; ");
  throw new Error(`Invalid SignalForge API configuration: ${detail}`);
}

if (
  parsed.data.NODE_ENV === "production" &&
  parsed.data.AUTH_SECRET === "replace-with-at-least-32-random-bytes"
) {
  throw new Error("AUTH_SECRET must be replaced in production.");
}
if (
  parsed.data.AI_PROVIDER === "openai" &&
  (!parsed.data.AI_API_KEY || !parsed.data.AI_MODEL)
) {
  throw new Error(
    "AI_PROVIDER=openai requires AI_API_KEY and AI_MODEL; no mock fallback is performed.",
  );
}

export const config = parsed.data;
