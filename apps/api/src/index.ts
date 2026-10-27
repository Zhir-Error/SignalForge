import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { createAuth } from "@signalforge/auth";
import { createDatabase } from "@signalforge/db";
import { ApiError } from "./security.js";
import { config } from "./config.js";
import { registerRoutes } from "./routes.js";

const database = createDatabase(config.DATABASE_URL);
const auth = createAuth(database.pool, {
  secret: config.AUTH_SECRET,
  apiBaseUrl: config.API_BASE_URL,
  appBaseUrl: config.APP_BASE_URL,
  production: config.NODE_ENV === "production",
});

const app = Fastify({
  logger: {
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "req.headers.set-cookie",
      ],
      remove: true,
    },
  },
  requestIdHeader: false,
  genReqId: () => randomUUID(),
  bodyLimit: Math.max(config.MAX_EVENT_PAYLOAD_BYTES + 4096, 40_000),
  trustProxy: config.TRUSTED_PROXY_IPS.trim()
    ? config.TRUSTED_PROXY_IPS.split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : false,
});

await app.register(cors, {
  origin: config.APP_BASE_URL,
  credentials: true,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "content-type",
    "authorization",
    "idempotency-key",
    "x-organization-id",
  ],
});
await app.register(rateLimit, {
  max: 600,
  timeWindow: 60_000,
  keyGenerator: (request) => request.ip,
  errorResponseBuilder: (_request, context) =>
    new ApiError(
      429,
      "RATE_LIMITED",
      `Too many requests. Retry in ${Math.ceil(context.ttl / 1000)} seconds.`,
    ),
});
app.addHook("onRequest", async (_request, reply) => {
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "DENY");
  reply.header("referrer-policy", "strict-origin-when-cross-origin");
  reply.header(
    "content-security-policy",
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  );
});

await registerRoutes(app, { database, auth });

const close = async () => {
  await app.close();
  await database.close();
};
process.once("SIGINT", () => {
  void close().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void close().then(() => process.exit(0));
});

try {
  await app.listen({ host: "0.0.0.0", port: 4000 });
} catch {
  app.log.error(
    { code: "API_START_FAILED" },
    "SignalForge API could not start",
  );
  await database.close();
  process.exitCode = 1;
}
