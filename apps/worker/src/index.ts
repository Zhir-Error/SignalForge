import { createHash } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
loadEnv({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
import { Queue, Worker, type Job, type QueueOptions } from "bullmq";
import { Redis } from "ioredis";
import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import { createInvestigationProvider } from "@signalforge/ai-investigator";
import { verificationResultSchema } from "@signalforge/contracts";
import {
  validateInvestigationCitations,
  redactAttributes,
  redactText,
} from "@signalforge/domain";
import {
  auditLogs,
  deployments,
  evidenceItems,
  hypotheses,
  hypothesisEvidence,
  incidentEvents,
  incidents,
  investigations,
  telemetryEvents,
  testScenarios,
  verificationRuns,
} from "@signalforge/db";
import { createDatabase } from "@signalforge/db";
import { correlateEvent } from "./correlation.js";
import { purgeExpiredTelemetry } from "./retention.js";
import {
  deferOutboxDispatch,
  heartbeatOutbox,
  markOutboxDelivered,
  reconcileStaleOutbox,
} from "./outbox-recovery.js";
import { authorizeOutboxDispatch } from "./outbox-dispatch.js";
import { markInvestigationRunning } from "./investigation-state.js";

const environment = z
  .object({
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url().optional(),
    AI_PROVIDER: z.enum(["mock", "openai"]).default("mock"),
    AI_API_KEY: z.string().optional(),
    AI_MODEL: z.string().optional(),
    AI_REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(120_000)
      .default(30_000),
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
    TELEMETRY_RETENTION_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(14),
    VERIFICATION_RUNNER_URL: z.string().url().default("http://127.0.0.1:4200"),
    VERIFICATION_RUNNER_SECRET: z.string().min(32),
    LOG_LEVEL: z.string().default("info"),
  })
  .parse(process.env);
if (
  environment.AI_PROVIDER === "openai" &&
  (!environment.AI_API_KEY || !environment.AI_MODEL)
)
  throw new Error("Live AI requires AI_API_KEY and AI_MODEL.");

const database = createDatabase(environment.DATABASE_URL);
const logger = {
  info: (message: string) =>
    process.stdout.write(`${new Date().toISOString()} INFO ${message}\n`),
  error: (message: string) =>
    process.stderr.write(`${new Date().toISOString()} ERROR ${message}\n`),
};
const investigationJobSchema = z
  .object({
    investigationId: z.string().uuid(),
    incidentId: z.string().uuid(),
    projectId: z.string().uuid(),
    organizationId: z.string().uuid(),
  })
  .strict();
const verificationJobSchema = z
  .object({
    runId: z.string().uuid(),
    incidentId: z.string().uuid(),
    scenarioId: z.string().uuid(),
    projectId: z.string().uuid(),
    organizationId: z.string().uuid(),
  })
  .strict();
const queueJobSchema = z
  .object({
    outboxId: z.string().uuid(),
    topic: z.string().max(80),
    payload: z.record(z.string(), z.unknown()),
  })
  .strict();

interface InvestigationWork {
  investigationId: string;
  organizationId: string;
  context: {
    investigationId: string;
    incident: {
      id: string;
      title: string;
      severity: string;
      firstSeenAt: string;
      lastSeenAt: string;
      fingerprint: string;
    };
    evidence: Array<{
      id: string;
      sourceType: string;
      occurredAt: string;
      content: string;
      attributes: Record<string, unknown>;
      contentHash: string;
    }>;
    deploymentContext: Array<{
      version: string;
      commitSha: string | null;
      deployedAt: string;
      minutesBeforeIncident: number;
    }>;
  };
}

async function prepareInvestigation(
  raw: unknown,
): Promise<InvestigationWork | null> {
  const job = investigationJobSchema.parse(raw);
  return database.withTenant(
    "signalforge-worker",
    job.organizationId,
    async (tx) => {
      const [investigation] = await tx
        .select()
        .from(investigations)
        .where(
          and(
            eq(investigations.id, job.investigationId),
            eq(investigations.organizationId, job.organizationId),
            eq(investigations.incidentId, job.incidentId),
          ),
        )
        .limit(1);
      if (
        !investigation ||
        !["queued", "running"].includes(investigation.status)
      )
        return null;
      const [incident] = await tx
        .select()
        .from(incidents)
        .where(
          and(
            eq(incidents.id, job.incidentId),
            eq(incidents.organizationId, job.organizationId),
            eq(incidents.projectId, job.projectId),
          ),
        )
        .limit(1);
      if (!incident) {
        await tx
          .update(investigations)
          .set({
            status: "failed",
            errorCode: "INCIDENT_NOT_FOUND",
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(investigations.id, job.investigationId),
              eq(investigations.organizationId, job.organizationId),
              inArray(investigations.status, ["queued", "running"]),
            ),
          );
        return null;
      }
      const markedRunning = await markInvestigationRunning(
        tx,
        {
          organizationId: job.organizationId,
          investigationId: job.investigationId,
        },
        investigation.startedAt ?? new Date(),
      );
      if (!markedRunning) return null;

      const from = new Date(incident.firstSeenAt.getTime() - 30 * 60 * 1000);
      const to = new Date(incident.lastSeenAt.getTime() + 10 * 60 * 1000);
      const eventConditions = [
        eq(telemetryEvents.organizationId, job.organizationId),
        eq(telemetryEvents.projectId, job.projectId),
        gte(telemetryEvents.occurredAt, from),
        lt(telemetryEvents.occurredAt, to),
      ];
      const related = await tx
        .select()
        .from(telemetryEvents)
        .where(
          and(
            ...eventConditions,
            or(
              eq(telemetryEvents.fingerprint, incident.fingerprint),
              incident.environmentId
                ? eq(telemetryEvents.environmentId, incident.environmentId)
                : isNull(telemetryEvents.environmentId),
            ),
          ),
        )
        .orderBy(asc(telemetryEvents.occurredAt))
        .limit(30);
      const deploymentsWhere = [
        eq(deployments.organizationId, job.organizationId),
        eq(deployments.projectId, job.projectId),
        gte(
          deployments.deployedAt,
          new Date(incident.firstSeenAt.getTime() - 60 * 60 * 1000),
        ),
        lt(deployments.deployedAt, incident.firstSeenAt),
      ];
      if (incident.environmentId)
        deploymentsWhere.push(
          eq(deployments.environmentId, incident.environmentId),
        );
      const recentDeployments = await tx
        .select()
        .from(deployments)
        .where(and(...deploymentsWhere))
        .orderBy(desc(deployments.deployedAt))
        .limit(10);
      let evidence = await tx
        .select()
        .from(evidenceItems)
        .where(
          and(
            eq(evidenceItems.organizationId, job.organizationId),
            eq(evidenceItems.investigationId, job.investigationId),
          ),
        )
        .orderBy(asc(evidenceItems.capturedAt))
        .limit(50);
      if (evidence.length === 0) {
        const values = [
          ...related.map((event) => {
            const content = redactText(
              `${event.eventType} ${event.severity}: ${event.message}`,
            );
            return {
              organizationId: job.organizationId,
              investigationId: job.investigationId,
              sourceType: "telemetry_event",
              sourceRef: event.id,
              sourceOccurredAt: event.occurredAt,
              content,
              contentHash: createHash("sha256").update(content).digest("hex"),
              attributes: redactAttributes({
                ...event.attributes,
                severity: event.severity,
                traceId: event.traceId,
                spanId: event.spanId,
              }),
            };
          }),
          ...recentDeployments.map((deployment) => {
            const content = redactText(
              `Deployment ${deployment.version} (${deployment.status}) recorded ${deployment.deployedAt.toISOString()}. Temporal association is not proof of causation.`,
            );
            return {
              organizationId: job.organizationId,
              investigationId: job.investigationId,
              sourceType: "deployment",
              sourceRef: deployment.id,
              sourceOccurredAt: deployment.deployedAt,
              content,
              contentHash: createHash("sha256").update(content).digest("hex"),
              attributes: {
                version: deployment.version,
                commitSha: deployment.commitSha,
                status: deployment.status,
              },
            };
          }),
        ];
        if (values.length > 0)
          evidence = await tx.insert(evidenceItems).values(values).returning();
      }
      const deploymentContext = recentDeployments.map((deployment) => ({
        version: deployment.version,
        commitSha: deployment.commitSha,
        deployedAt: deployment.deployedAt.toISOString(),
        minutesBeforeIncident: Math.max(
          0,
          Math.round(
            (incident.firstSeenAt.getTime() - deployment.deployedAt.getTime()) /
              60_000,
          ),
        ),
      }));
      return {
        investigationId: job.investigationId,
        organizationId: job.organizationId,
        context: {
          investigationId: job.investigationId,
          incident: {
            id: incident.id,
            title: incident.title,
            severity: incident.severity,
            firstSeenAt: incident.firstSeenAt.toISOString(),
            lastSeenAt: incident.lastSeenAt.toISOString(),
            fingerprint: incident.fingerprint,
          },
          evidence: evidence.map((item) => ({
            id: item.id,
            sourceType: item.sourceType,
            occurredAt:
              item.sourceOccurredAt?.toISOString() ??
              item.capturedAt.toISOString(),
            content: item.content.slice(0, 8000),
            attributes: item.attributes,
            contentHash: item.contentHash,
          })),
          deploymentContext,
        },
      };
    },
  );
}

async function runInvestigation(raw: unknown): Promise<void> {
  const job = investigationJobSchema.parse(raw);
  const work = await prepareInvestigation(job);
  if (!work) return;
  const provider = createInvestigationProvider({
    provider: environment.AI_PROVIDER,
    ...(environment.AI_API_KEY ? { apiKey: environment.AI_API_KEY } : {}),
    ...(environment.AI_MODEL ? { model: environment.AI_MODEL } : {}),
  });
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    environment.AI_REQUEST_TIMEOUT_MS,
  );
  let providerResponse;
  try {
    providerResponse = await provider.investigate(
      work.context,
      controller.signal,
    );
  } catch (error) {
    clearTimeout(timeout);
    const transient =
      error instanceof Error &&
      [
        "PROVIDER_RATE_LIMITED",
        "PROVIDER_REQUEST_FAILED",
        "PROVIDER_INVALID_RESPONSE",
      ].includes(error.message);
    await database.withTenant(
      "signalforge-worker",
      job.organizationId,
      async (tx) => {
        await tx
          .update(investigations)
          .set({
            status: transient ? "queued" : "failed",
            errorCode: controller.signal.aborted
              ? "PROVIDER_TIMEOUT"
              : "PROVIDER_UNAVAILABLE",
            finishedAt: transient ? null : new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(investigations.id, job.investigationId),
              eq(investigations.organizationId, job.organizationId),
            ),
          );
      },
    );
    if (transient || controller.signal.aborted)
      throw new Error("PROVIDER_RETRYABLE_FAILURE");
    return;
  } finally {
    clearTimeout(timeout);
  }
  let result;
  try {
    const allowed = new Set(work.context.evidence.map((item) => item.id));
    result = validateInvestigationCitations(providerResponse.output, allowed);
  } catch {
    await database.withTenant(
      "signalforge-worker",
      job.organizationId,
      async (tx) => {
        await tx
          .update(investigations)
          .set({
            status: "failed",
            errorCode: "INVALID_PROVIDER_OUTPUT",
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(investigations.id, job.investigationId),
              eq(investigations.organizationId, job.organizationId),
            ),
          );
      },
    );
    return;
  }
  await database.withTenant(
    "signalforge-worker",
    job.organizationId,
    async (tx) => {
      await tx
        .delete(hypotheses)
        .where(
          and(
            eq(hypotheses.organizationId, job.organizationId),
            eq(hypotheses.investigationId, job.investigationId),
          ),
        );
      await tx
        .update(investigations)
        .set({
          status: "completed",
          provider: providerResponse.provider,
          model: providerResponse.model,
          inputTokens: providerResponse.inputTokens,
          outputTokens: providerResponse.outputTokens,
          summary: result.summary,
          result,
          errorCode: null,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(investigations.id, job.investigationId),
            eq(investigations.organizationId, job.organizationId),
          ),
        );
      for (let index = 0; index < result.hypotheses.length; index += 1) {
        const item = result.hypotheses[index];
        if (!item) continue;
        const [hypothesis] = await tx
          .insert(hypotheses)
          .values({
            organizationId: job.organizationId,
            investigationId: job.investigationId,
            claim: item.claim,
            rationale: item.rationale,
            confidence: item.confidence,
            proposedCheck: item.proposedCheck,
            sortOrder: index,
          })
          .returning({ id: hypotheses.id });
        if (!hypothesis) continue;
        const links = [
          ...item.supportingEvidenceIds.map((evidenceId) => ({
            organizationId: job.organizationId,
            investigationId: job.investigationId,
            hypothesisId: hypothesis.id,
            evidenceId,
            relationship: "supports",
          })),
          ...item.contradictingEvidenceIds.map((evidenceId) => ({
            organizationId: job.organizationId,
            investigationId: job.investigationId,
            hypothesisId: hypothesis.id,
            evidenceId,
            relationship: "contradicts",
          })),
        ];
        if (links.length > 0) await tx.insert(hypothesisEvidence).values(links);
      }
      await tx.insert(auditLogs).values({
        organizationId: job.organizationId,
        actorUserId: null,
        action: "investigation.completed",
        resourceType: "investigation",
        resourceId: job.investigationId,
        metadata: {
          provider: providerResponse.provider,
          model: providerResponse.model,
          mock: providerResponse.provider === "mock",
        },
      });
    },
  );
}

async function runVerification(raw: unknown): Promise<void> {
  const job = verificationJobSchema.parse(raw);
  const run = await database.withTenant(
    "signalforge-worker",
    job.organizationId,
    async (tx) => {
      const [current] = await tx
        .select()
        .from(verificationRuns)
        .where(
          and(
            eq(verificationRuns.id, job.runId),
            eq(verificationRuns.organizationId, job.organizationId),
            eq(verificationRuns.incidentId, job.incidentId),
            eq(verificationRuns.scenarioId, job.scenarioId),
          ),
        )
        .limit(1);
      if (!current || !["queued", "running"].includes(current.status))
        return null;
      const [scenario] = await tx
        .select()
        .from(testScenarios)
        .where(
          and(
            eq(testScenarios.id, job.scenarioId),
            eq(testScenarios.organizationId, job.organizationId),
            eq(testScenarios.projectId, job.projectId),
            eq(testScenarios.enabled, true),
          ),
        )
        .limit(1);
      if (!scenario) {
        await tx
          .update(verificationRuns)
          .set({
            status: "error",
            errorCode: "SCENARIO_NOT_AVAILABLE",
            finishedAt: new Date(),
          })
          .where(eq(verificationRuns.id, job.runId));
        return null;
      }
      await tx
        .update(verificationRuns)
        .set({
          status: "running",
          startedAt: current.startedAt ?? new Date(),
          errorCode: null,
        })
        .where(eq(verificationRuns.id, job.runId));
      return {
        scenarioKey: scenario.scenarioKey,
        scenarioVersion: current.scenarioVersion,
        startedAt: current.startedAt ?? new Date(),
      };
    },
  );
  if (!run) return;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    environment.VERIFICATION_TIMEOUT_MS,
  );
  try {
    const response = await fetch(
      `${environment.VERIFICATION_RUNNER_URL}/internal/run`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${environment.VERIFICATION_RUNNER_SECRET}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          scenarioKey: run.scenarioKey,
          scenarioVersion: run.scenarioVersion,
        }),
      },
    );
    if (!response.ok) throw new Error("RUNNER_UNAVAILABLE");
    const rawResponse: unknown = await response.json();
    const parsed = z
      .object({
        data: verificationResultSchema,
        requestId: z.string().max(100),
      })
      .strict()
      .safeParse(rawResponse);
    if (!parsed.success) throw new Error("RUNNER_INVALID_RESULT");
    const reportText = JSON.stringify(parsed.data.data);
    if (
      Buffer.byteLength(reportText, "utf8") >
      environment.VERIFICATION_MAX_OUTPUT_BYTES
    )
      throw new Error("RUNNER_OUTPUT_TOO_LARGE");
    const finishedAt = new Date();
    await database.withTenant(
      "signalforge-worker",
      job.organizationId,
      async (tx) => {
        await tx
          .update(verificationRuns)
          .set({
            status: parsed.data.data.status,
            summary: parsed.data.data.summary.slice(0, 1000),
            report: parsed.data.data,
            errorCode: null,
            finishedAt,
            durationMs: Math.max(
              0,
              finishedAt.getTime() - run.startedAt.getTime(),
            ),
          })
          .where(
            and(
              eq(verificationRuns.id, job.runId),
              eq(verificationRuns.organizationId, job.organizationId),
            ),
          );
        await tx.insert(incidentEvents).values({
          organizationId: job.organizationId,
          incidentId: job.incidentId,
          eventType: "verification_completed",
          payload: { runId: job.runId, status: parsed.data.data.status },
        });
        await tx.insert(auditLogs).values({
          organizationId: job.organizationId,
          actorUserId: null,
          action: "verification.completed",
          resourceType: "verification_run",
          resourceId: job.runId,
          metadata: {
            status: parsed.data.data.status,
            scenarioVersion: run.scenarioVersion,
          },
        });
      },
    );
  } catch {
    await database.withTenant(
      "signalforge-worker",
      job.organizationId,
      async (tx) => {
        await tx
          .update(verificationRuns)
          .set({
            status: "queued",
            errorCode: controller.signal.aborted
              ? "RUNNER_TIMEOUT_RETRYING"
              : "RUNNER_UNAVAILABLE_RETRYING",
            startedAt: null,
            finishedAt: null,
          })
          .where(
            and(
              eq(verificationRuns.id, job.runId),
              eq(verificationRuns.organizationId, job.organizationId),
            ),
          );
      },
    );
    throw new Error("RUNNER_RETRYABLE_FAILURE");
  } finally {
    clearTimeout(timeout);
  }
}

async function processJob(topic: string, payload: unknown): Promise<void> {
  if (topic === "event.correlation") return correlateEvent(database, payload);
  if (topic === "investigation.run") return runInvestigation(payload);
  if (topic === "verification.run") return runVerification(payload);
  throw new Error("UNKNOWN_JOB_TOPIC");
}

async function markFinalFailure(
  topic: string,
  rawPayload: unknown,
): Promise<void> {
  const payload = z.record(z.string(), z.unknown()).safeParse(rawPayload);
  if (!payload.success || typeof payload.data.organizationId !== "string")
    return;
  const organizationId = payload.data.organizationId;
  await database.withTenant(
    "signalforge-worker",
    organizationId,
    async (tx) => {
      if (
        topic === "investigation.run" &&
        typeof payload.data.investigationId === "string"
      )
        await tx
          .update(investigations)
          .set({
            status: "failed",
            errorCode: "JOB_RETRIES_EXHAUSTED",
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(investigations.id, payload.data.investigationId),
              eq(investigations.organizationId, organizationId),
              inArray(investigations.status, ["queued", "running"]),
            ),
          );
      if (
        topic === "verification.run" &&
        typeof payload.data.runId === "string"
      )
        await tx
          .update(verificationRuns)
          .set({
            status: "error",
            errorCode: "JOB_RETRIES_EXHAUSTED",
            finishedAt: new Date(),
          })
          .where(
            and(
              eq(verificationRuns.id, payload.data.runId),
              eq(verificationRuns.organizationId, organizationId),
              inArray(verificationRuns.status, ["queued", "running"]),
            ),
          );
    },
  );
}

async function claimOutbox() {
  const result = await database.pool.query<{
    id: string;
    topic: string;
    payload: Record<string, unknown>;
    organization_id: string;
    attempts: number;
  }>(
    `WITH candidate AS (
       SELECT id FROM outbox WHERE status = 'pending' AND available_at <= now()
       ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
     )
     UPDATE outbox AS item SET status = 'processing', locked_at = now(), attempts = item.attempts + 1
     FROM candidate WHERE item.id = candidate.id
     RETURNING item.id, item.topic, item.payload, item.organization_id, item.attempts`,
  );
  return result.rows[0] ?? null;
}

async function handleOutboxFailure(
  item: NonNullable<Awaited<ReturnType<typeof claimOutbox>>>,
  error: unknown,
): Promise<void> {
  const code =
    error instanceof Error && error.message.includes("RETRYABLE")
      ? "DEPENDENCY_RETRYABLE"
      : "JOB_PROCESSING_FAILED";
  if (item.attempts >= 5) {
    await markFinalFailure(item.topic, item.payload);
    await database.pool.query(
      "UPDATE outbox SET status='failed', last_error_code=$2, locked_at=NULL WHERE id=$1",
      [item.id, code],
    );
    return;
  }
  const delayMs = Math.min(60_000, 1_000 * 2 ** (item.attempts - 1));
  await database.pool.query(
    "UPDATE outbox SET status='pending', available_at=now() + ($2 * interval '1 millisecond'), last_error_code=$3, locked_at=NULL WHERE id=$1",
    [item.id, delayMs, code],
  );
}

const redis = environment.REDIS_URL
  ? new Redis(environment.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    })
  : null;
const queueOptions: QueueOptions | null = redis ? { connection: redis } : null;
const queue =
  redis && queueOptions ? new Queue("signalforge-jobs", queueOptions) : null;
const processor = redis
  ? new Worker(
      "signalforge-jobs",
      async (job: Job) => {
        const parsed = queueJobSchema.parse(job.data);
        const authorized = await authorizeOutboxDispatch(database.pool, parsed);
        if (!authorized) return;
        await processJob(parsed.topic, parsed.payload);
        await markOutboxDelivered(database.pool, parsed.outboxId);
      },
      { connection: redis, concurrency: 5, lockDuration: 120_000 },
    )
  : null;

if (processor)
  processor.on("failed", (job) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const parsed = queueJobSchema.safeParse(job.data);
      if (!parsed.success) return;
      void authorizeOutboxDispatch(database.pool, parsed.data)
        .then((authorized) =>
          authorized
            ? markFinalFailure(parsed.data.topic, parsed.data.payload).then(
                () =>
                  database.pool.query(
                    "UPDATE outbox SET status='failed', last_error_code='JOB_RETRIES_EXHAUSTED', locked_at=NULL WHERE id=$1 AND status='processing'",
                    [parsed.data.outboxId],
                  ),
              )
            : undefined,
        )
        .catch(() => undefined);
    }
  });

let polling = false;
const poll = async () => {
  if (polling) return;
  polling = true;
  try {
    const item = await claimOutbox();
    if (item) {
      try {
        if (queue) {
          try {
            await queue.add(
              item.topic,
              { outboxId: item.id, topic: item.topic, payload: item.payload },
              {
                jobId: item.id,
                attempts: 4,
                backoff: { type: "exponential", delay: 1000 },
                removeOnComplete: 500,
                removeOnFail: 1000,
              },
            );
          } catch {
            logger.error("outbox dispatch deferred until queue is available");
            await deferOutboxDispatch(database.pool, item.id, item.attempts);
            return;
          }
        } else {
          const heartbeat = setInterval(() => {
            void heartbeatOutbox(database.pool, item.id).catch(() =>
              logger.error("outbox heartbeat failed"),
            );
          }, 20_000);
          try {
            await processJob(item.topic, item.payload);
          } finally {
            clearInterval(heartbeat);
          }
        }
        if (!queue) await markOutboxDelivered(database.pool, item.id);
      } catch (error) {
        logger.error("outbox item failed");
        await handleOutboxFailure(item, error);
      }
    }
  } catch {
    logger.error("outbox poll failed");
  } finally {
    polling = false;
  }
};
const timer = setInterval(() => {
  void poll();
}, 500);
void poll();
let recovering = false;
const recoverStale = async () => {
  if (recovering) return;
  recovering = true;
  try {
    await reconcileStaleOutbox(database.pool, queue, markFinalFailure);
  } catch {
    logger.error("stale outbox recovery failed");
  } finally {
    recovering = false;
  }
};
void recoverStale();
const recoveryTimer = setInterval(() => {
  void recoverStale();
}, 30_000);
logger.info(
  redis
    ? "worker started with Redis/BullMQ and PostgreSQL outbox"
    : "worker started in PostgreSQL outbox fallback mode (Redis unavailable)",
);
let retentionRunning = false;
const runRetention = async () => {
  if (retentionRunning) return;
  retentionRunning = true;
  try {
    await purgeExpiredTelemetry(database, environment.TELEMETRY_RETENTION_DAYS);
  } catch {
    logger.error("telemetry retention batch failed");
  } finally {
    retentionRunning = false;
  }
};
const retentionTimer = setInterval(
  () => {
    void runRetention();
  },
  24 * 60 * 60 * 1000,
);
void runRetention();

const shutdown = async () => {
  clearInterval(timer);
  clearInterval(recoveryTimer);
  clearInterval(retentionTimer);
  if (processor) await processor.close();
  if (queue) await queue.close();
  if (redis) await redis.quit();
  await database.close();
};
process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
