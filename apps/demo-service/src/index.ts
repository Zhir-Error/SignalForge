import { timingSafeEqual } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { Pool } from "pg";
import { evaluateCheckoutConfiguration } from "./scenarios.js";

const configuredDatabaseUrl = process.env.DEMO_DATABASE_URL;
const configuredDatabase = evaluateCheckoutConfiguration(configuredDatabaseUrl);
const database =
  configuredDatabase.status === 200
    ? new Pool({
        connectionString: configuredDatabaseUrl,
        max: 2,
        connectionTimeoutMillis: 2_000,
        idleTimeoutMillis: 5_000,
        statement_timeout: 2_000,
      })
    : null;
const scenarioSecret = process.env.VERIFICATION_RUNNER_SECRET;

if (!scenarioSecret || scenarioSecret.length < 32) {
  throw new Error(
    "VERIFICATION_RUNNER_SECRET must be at least 32 characters for internal scenario checks.",
  );
}
if (process.env.NODE_ENV === "production" && !database) {
  throw new Error(
    "DEMO_DATABASE_URL must be a valid PostgreSQL URL in production.",
  );
}

async function checkDatabase(databaseUrl: string | undefined) {
  const configuration = evaluateCheckoutConfiguration(databaseUrl);
  if (configuration.status !== 200 || !databaseUrl) return configuration;

  const useSharedPool = databaseUrl === configuredDatabaseUrl && database;
  const pool = useSharedPool
    ? database
    : new Pool({
        connectionString: databaseUrl,
        max: 1,
        connectionTimeoutMillis: 1_000,
        statement_timeout: 1_000,
      });

  try {
    const result = await pool.query<{ available: number }>(
      "SELECT 1 AS available",
    );
    if (result.rows[0]?.available !== 1) {
      return {
        status: 503 as const,
        code: "DATABASE_CONNECTION_FAILED" as const,
        message: "Database connectivity check returned an unexpected result.",
      };
    }
    return {
      status: 200 as const,
      code: "CHECKOUT_READY" as const,
      message: "Database query succeeded.",
    };
  } catch (error) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "DATABASE_ERROR";
    return {
      status: 503 as const,
      code: "DATABASE_CONNECTION_FAILED" as const,
      message: `Database connectivity check failed (${code}).`,
    };
  } finally {
    if (!useSharedPool) await pool.end();
  }
}

const sdk = new NodeSDK({ instrumentations: [getNodeAutoInstrumentations()] });
await sdk.start();
const { default: Fastify } = await import("fastify");
const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization"],
  },
  genReqId: () => crypto.randomUUID(),
});

await server.register((await import("@fastify/rate-limit")).default, {
  max: 60,
  timeWindow: 60_000,
});

server.get("/health", async (request) => ({
  data: { status: "ok", service: "checkout-api" },
  requestId: request.id,
}));

server.get("/checkout", async (request, reply) => {
  const outcome = await checkDatabase(configuredDatabaseUrl);
  let telemetryAccepted = false;
  if (outcome.status === 503 && process.env.DEMO_API_KEY) {
    try {
      const response = await fetch(
        `${process.env.API_BASE_URL ?? "http://localhost:4000"}/v1/ingest/events`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${process.env.DEMO_API_KEY}`,
            "content-type": "application/json",
            "idempotency-key": `demo-checkout-${request.id}`,
          },
          body: JSON.stringify({
            eventType: "error",
            occurredAt: new Date().toISOString(),
            service: "checkout-api",
            environment: "staging",
            severity: "error",
            traceId: request.id
              .replace(/[^a-zA-Z0-9_-]/g, "")
              .slice(0, 32)
              .padEnd(8, "0"),
            message: outcome.message,
            attributes: {
              error_type: "DatabaseConnectionError",
              http_route: "/checkout",
              http_status_code: outcome.status,
            },
          }),
          signal: AbortSignal.timeout(3_000),
        },
      );
      telemetryAccepted = response.ok;
      if (!response.ok)
        request.log.warn(
          { requestId: request.id, code: "TELEMETRY_REJECTED" },
          "Demo telemetry was rejected by the ingestion API",
        );
    } catch {
      request.log.warn(
        { requestId: request.id, code: "TELEMETRY_DELIVERY_FAILED" },
        "Demo telemetry could not be delivered",
      );
    }
  }
  if (outcome.status === 503)
    request.log.warn(
      { requestId: request.id, code: outcome.code },
      "Demo checkout dependency check failed",
    );
  return reply.code(outcome.status).send({
    data: { code: outcome.code, message: outcome.message, telemetryAccepted },
    requestId: request.id,
  });
});

server.get<{ Params: { scenarioKey: string } }>(
  "/internal/scenarios/:scenarioKey",
  async (request, reply) => {
    const authorization = request.headers.authorization;
    const expected = Buffer.from(`Bearer ${scenarioSecret}`);
    const provided = Buffer.from(
      typeof authorization === "string" ? authorization : "",
    );
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(provided, expected)
    )
      return reply.code(401).send({ error: { code: "UNAUTHORIZED" } });

    if (request.params.scenarioKey === "recovery-check") {
      const outcome = await checkDatabase(configuredDatabaseUrl);
      return reply.code(outcome.status).send({
        data: outcome,
        requestId: request.id,
      });
    }
    if (request.params.scenarioKey === "known-failure") {
      const outcome = await checkDatabase(
        "postgresql://signalforge_demo:invalid@127.0.0.1:1/signalforge_demo",
      );
      return reply.code(outcome.status).send({
        data: outcome,
        requestId: request.id,
      });
    }
    return reply.code(404).send({ error: { code: "SCENARIO_NOT_REGISTERED" } });
  },
);

const port = Number(process.env.DEMO_SERVICE_PORT ?? 4100);
await server.listen({ host: "0.0.0.0", port });

let isClosing = false;
const shutdown = async () => {
  if (isClosing) return;
  isClosing = true;
  await server.close();
  await database?.end();
  await sdk.shutdown();
};
process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
