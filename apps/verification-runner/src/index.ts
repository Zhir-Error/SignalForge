import { randomUUID, timingSafeEqual } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
import Fastify from "fastify";
import { z } from "zod";
import {
  registeredScenarios,
  runRegisteredScenario,
  scenarioKeySchema,
} from "./scenarios.js";

const runnerSecret = process.env.VERIFICATION_RUNNER_SECRET;
const demoServiceUrl = process.env.DEMO_SERVICE_URL ?? "http://127.0.0.1:4100";
const timeoutMs = z.coerce
  .number()
  .int()
  .min(100)
  .max(300_000)
  .default(60_000)
  .parse(process.env.VERIFICATION_TIMEOUT_MS);
if (!runnerSecret || runnerSecret.length < 32)
  throw new Error("VERIFICATION_RUNNER_SECRET must be at least 32 characters.");
const parsedDemoServiceUrl = new URL(demoServiceUrl);
if (!new Set(["http:", "https:"]).has(parsedDemoServiceUrl.protocol))
  throw new Error("DEMO_SERVICE_URL must use HTTP or HTTPS.");

const runner = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["req.headers.authorization"],
  },
  genReqId: () => randomUUID(),
});
runner.get("/health", async () => ({
  data: { status: "ok", service: "signalforge-verification-runner" },
}));
runner.post("/internal/run", async (request, reply) => {
  const authorization = request.headers.authorization;
  const expected = Buffer.from(`Bearer ${runnerSecret}`);
  const provided = Buffer.from(
    typeof authorization === "string" ? authorization : "",
  );
  if (
    provided.length !== expected.length ||
    !timingSafeEqual(provided, expected)
  )
    return reply.code(401).send({ error: { code: "UNAUTHORIZED" } });
  const input = z
    .object({
      scenarioKey: scenarioKeySchema,
      scenarioVersion: z.string().max(40),
    })
    .strict()
    .safeParse(request.body);
  if (!input.success)
    return reply.code(400).send({ error: { code: "INVALID_SCENARIO" } });
  const registered = registeredScenarios[input.data.scenarioKey];
  if (input.data.scenarioVersion !== registered.version)
    return reply
      .code(409)
      .send({ error: { code: "SCENARIO_VERSION_MISMATCH" } });
  return {
    data: await runRegisteredScenario(
      input.data.scenarioKey,
      demoServiceUrl,
      runnerSecret,
      timeoutMs,
    ),
    requestId: request.id,
  };
});

const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65_535)
  .default(4200)
  .parse(process.env.VERIFICATION_RUNNER_PORT);
await runner.listen({
  host:
    process.env.VERIFICATION_RUNNER_HOST ??
    (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
  port,
});
