import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  auditLogs,
  apiKeys,
  createDatabase,
  environments,
  incidentEvents,
  incidents,
  investigations,
  organizations,
  outbox,
  projects,
  services,
  telemetryEvents,
  users,
} from "../packages/db/src/index.js";
import { correlateEvent } from "../apps/worker/src/correlation.js";
import { purgeExpiredTelemetry } from "../apps/worker/src/retention.js";
import {
  deferOutboxDispatch,
  reconcileStaleOutbox,
} from "../apps/worker/src/outbox-recovery.js";
import {
  authenticateProjectKey,
  createProjectKey,
} from "../apps/api/src/key-auth.js";
import { ingestTelemetry } from "../apps/api/src/ingestion.js";
import {
  cancelQueuedInvestigation,
  retryFailedInvestigation,
} from "../apps/api/src/investigations.js";
import { markInvestigationRunning } from "../apps/worker/src/investigation-state.js";

loadEnv();
const connectionString = process.env.DATABASE_URL;
const integration = describe.skipIf(!connectionString);
let database: ReturnType<typeof createDatabase> | undefined;

afterAll(async () => {
  await database?.close();
});

integration("PostgreSQL tenant policies", () => {
  it("requires the restricted runtime role and blocks cross-organization project reads", async () => {
    if (!connectionString)
      throw new Error("DATABASE_URL is required for this integration test.");
    database = createDatabase(connectionString);
    const roleResult = await database.pool.query<{
      role_name: string;
      is_superuser: boolean;
    }>(
      "SELECT current_user AS role_name, rolsuper AS is_superuser FROM pg_roles WHERE rolname = current_user",
    );
    expect(roleResult.rows[0]?.is_superuser).toBe(false);
    expect(roleResult.rows[0]?.role_name).toBe("signalforge_app");

    const firstOrganizationId = randomUUID();
    const secondOrganizationId = randomUUID();
    const firstProjectId = randomUUID();
    const secondProjectId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    try {
      await database.db.insert(organizations).values([
        {
          id: firstOrganizationId,
          name: "Isolation test A",
          slug: `isolation-a-${suffix}`,
        },
        {
          id: secondOrganizationId,
          name: "Isolation test B",
          slug: `isolation-b-${suffix}`,
        },
      ]);
      await database.withTenant(
        "isolation-test-user",
        firstOrganizationId,
        (tx) =>
          tx.insert(projects).values({
            id: firstProjectId,
            organizationId: firstOrganizationId,
            name: "Project A",
            slug: "project-a",
          }),
      );
      await database.withTenant(
        "isolation-test-user",
        secondOrganizationId,
        (tx) =>
          tx.insert(projects).values({
            id: secondProjectId,
            organizationId: secondOrganizationId,
            name: "Project B",
            slug: "project-b",
          }),
      );

      const firstTenantRows = await database.withTenant(
        "isolation-test-user",
        firstOrganizationId,
        (tx) =>
          tx
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.organizationId, firstOrganizationId),
                inArray(projects.id, [firstProjectId, secondProjectId]),
              ),
            ),
      );
      const secondTenantRows = await database.withTenant(
        "isolation-test-user",
        secondOrganizationId,
        (tx) =>
          tx
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.organizationId, secondOrganizationId),
                inArray(projects.id, [firstProjectId, secondProjectId]),
              ),
            ),
      );
      expect(firstTenantRows.map((row) => row.id)).toEqual([firstProjectId]);
      expect(secondTenantRows.map((row) => row.id)).toEqual([secondProjectId]);

      const unscopedRows = await database.db
        .select({ id: projects.id })
        .from(projects)
        .where(inArray(projects.id, [firstProjectId, secondProjectId]));
      expect(unscopedRows).toEqual([]);
    } finally {
      await database.db
        .delete(organizations)
        .where(
          inArray(organizations.id, [
            firstOrganizationId,
            secondOrganizationId,
          ]),
        );
    }
  }, 30_000);

  it("clears transaction-local tenant context when a pooled connection is reused", async () => {
    if (!connectionString)
      throw new Error("DATABASE_URL is required for this integration test.");
    const singleConnectionDatabase = createDatabase(connectionString, {
      max: 1,
    });
    const organizationId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    try {
      await singleConnectionDatabase.db.insert(organizations).values({
        id: organizationId,
        name: "Pool reuse integration",
        slug: `pool-reuse-${suffix}`,
      });
      const [before] = (
        await singleConnectionDatabase.pool.query<{ pid: number }>(
          "SELECT pg_backend_pid() AS pid",
        )
      ).rows;

      await singleConnectionDatabase.withTenant(
        "pool-reuse-test-user",
        organizationId,
        (tx) =>
          tx.insert(projects).values({
            organizationId,
            name: "Pool reuse project",
            slug: "pool-reuse-project",
          }),
      );

      const [after] = (
        await singleConnectionDatabase.pool.query<{
          pid: number;
          tenant: string | null;
        }>(
          "SELECT pg_backend_pid() AS pid, current_setting('app.organization_id', true) AS tenant",
        )
      ).rows;
      expect(after?.pid).toBe(before?.pid);
      expect([null, ""]).toContain(after?.tenant);
      expect(
        await singleConnectionDatabase.db
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.organizationId, organizationId)),
      ).toEqual([]);
    } finally {
      await singleConnectionDatabase.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await singleConnectionDatabase.close();
    }
  }, 30_000);

  it("purges only telemetry older than the configured retention window", async () => {
    if (!database)
      throw new Error("The database integration setup did not run.");
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const oldEventId = randomUUID();
    const recentEventId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const now = new Date();
    try {
      await database.db.insert(organizations).values({
        id: organizationId,
        name: "Retention integration",
        slug: `retention-${suffix}`,
      });
      await database.withTenant("retention-test-user", organizationId, (tx) =>
        tx.insert(projects).values({
          id: projectId,
          organizationId,
          name: "Retention test project",
          slug: "retention-test",
        }),
      );
      await database.withTenant("retention-test-user", organizationId, (tx) =>
        tx.insert(telemetryEvents).values([
          {
            id: oldEventId,
            organizationId,
            projectId,
            eventType: "log",
            severity: "info",
            occurredAt: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
            message: "Expired telemetry fixture",
          },
          {
            id: recentEventId,
            organizationId,
            projectId,
            eventType: "log",
            severity: "info",
            occurredAt: now,
            message: "Retained telemetry fixture",
          },
        ]),
      );

      await purgeExpiredTelemetry(database, 14);

      const remaining = await database.withTenant(
        "retention-test-user",
        organizationId,
        (tx) =>
          tx
            .select({ id: telemetryEvents.id })
            .from(telemetryEvents)
            .where(eq(telemetryEvents.organizationId, organizationId)),
      );
      expect(remaining.map((event) => event.id)).toEqual([recentEventId]);
      const auditRows = await database.withTenant(
        "retention-test-user",
        organizationId,
        (tx) =>
          tx
            .select({ action: auditLogs.action })
            .from(auditLogs)
            .where(eq(auditLogs.organizationId, organizationId)),
      );
      expect(auditRows.map((row) => row.action)).toContain(
        "telemetry.retention_purged",
      );
    } finally {
      await database.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  }, 30_000);

  it("reclaims stale PostgreSQL outbox leases without losing retry counts", async () => {
    if (!database)
      throw new Error("The database integration setup did not run.");
    const organizationId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const itemId = randomUUID();
    try {
      await database.db.insert(organizations).values({
        id: organizationId,
        name: "Outbox recovery integration",
        slug: `outbox-recovery-${suffix}`,
      });
      await database.db.insert(outbox).values({
        id: itemId,
        organizationId,
        topic: "investigation.run",
        payload: { organizationId, investigationId: randomUUID() },
        status: "processing",
        attempts: 3,
        lockedAt: new Date(Date.now() - 10 * 60 * 1000),
      });

      await reconcileStaleOutbox(database.pool, null, async () => undefined);

      const recovered = await database.pool.query<{
        status: string;
        attempts: number;
        locked_at: Date | null;
      }>("SELECT status, attempts, locked_at FROM outbox WHERE id=$1", [
        itemId,
      ]);
      expect(recovered.rows[0]).toMatchObject({
        status: "pending",
        attempts: 3,
        locked_at: null,
      });
    } finally {
      await database.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  }, 30_000);

  it("defers Redis dispatch outages instead of exhausting the job retry budget", async () => {
    if (!database)
      throw new Error("The database integration setup did not run.");
    const organizationId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const itemId = randomUUID();
    try {
      await database.db.insert(organizations).values({
        id: organizationId,
        name: "Outbox dispatch retry integration",
        slug: `outbox-dispatch-${suffix}`,
      });
      await database.db.insert(outbox).values({
        id: itemId,
        organizationId,
        topic: "investigation.run",
        payload: { organizationId, investigationId: randomUUID() },
        status: "processing",
        attempts: 7,
        lockedAt: new Date(),
      });

      await deferOutboxDispatch(database.pool, itemId, 7);

      const deferred = await database.pool.query<{
        status: string;
        attempts: number;
        locked_at: Date | null;
        available_at: Date;
        last_error_code: string | null;
      }>(
        "SELECT status, attempts, locked_at, available_at, last_error_code FROM outbox WHERE id=$1",
        [itemId],
      );
      expect(deferred.rows[0]).toMatchObject({
        status: "pending",
        attempts: 7,
        locked_at: null,
        last_error_code: "QUEUE_DISPATCH_RETRYING",
      });
      expect(deferred.rows[0]?.available_at.getTime()).toBeGreaterThan(
        Date.now() + 50_000,
      );
    } finally {
      await database.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  }, 30_000);

  it("reconciles stale Redis-backed outbox rows from BullMQ job state", async () => {
    if (!database)
      throw new Error("The database integration setup did not run.");
    const organizationId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    const failedJobs: string[] = [];
    try {
      await database.db.insert(organizations).values({
        id: organizationId,
        name: "Redis outbox recovery integration",
        slug: `redis-outbox-recovery-${suffix}`,
      });
      await database.db.insert(outbox).values(
        ids.map((id) => ({
          id,
          organizationId,
          topic: "investigation.run",
          payload: { organizationId, investigationId: id },
          status: "processing",
          attempts: 1,
          lockedAt: new Date(Date.now() - 10 * 60 * 1000),
        })),
      );
      const states = new Map([
        [ids[0]!, "active"],
        [ids[1]!, "completed"],
        [ids[2]!, "failed"],
      ]);

      await reconcileStaleOutbox(
        database.pool,
        {
          async getJob(id) {
            const state = states.get(id);
            return state
              ? {
                  async getState() {
                    return state;
                  },
                }
              : undefined;
          },
        },
        async (_topic, payload) => {
          failedJobs.push(String(payload.investigationId));
        },
      );

      const recovered = await database.pool.query<{
        id: string;
        status: string;
        locked_at: Date | null;
      }>(
        "SELECT id, status, locked_at FROM outbox WHERE id = ANY($1::uuid[])",
        [ids],
      );
      const byId = new Map(recovered.rows.map((row) => [row.id, row]));
      expect(byId.get(ids[0]!)).toMatchObject({ status: "processing" });
      expect(byId.get(ids[0]!)?.locked_at?.getTime()).toBeGreaterThan(
        Date.now() - 60_000,
      );
      expect(byId.get(ids[1]!)).toMatchObject({ status: "delivered" });
      expect(byId.get(ids[2]!)).toMatchObject({ status: "failed" });
      expect(failedJobs).toEqual([ids[2]!]);
    } finally {
      await database.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  }, 30_000);

  it("correlates idempotently within organization, project, and environment", async () => {
    if (!database)
      throw new Error("The database integration setup did not run.");
    const firstOrganizationId = randomUUID();
    const secondOrganizationId = randomUUID();
    const firstProjectId = randomUUID();
    const secondProjectId = randomUUID();
    const productionId = randomUUID();
    const stagingId = randomUUID();
    const otherProductionId = randomUUID();
    const eventIds = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    const suffix = randomUUID().slice(0, 8);
    const now = Date.now();
    const fingerprint = "a".repeat(64);
    try {
      await database.db.insert(organizations).values([
        {
          id: firstOrganizationId,
          name: "Correlation integration A",
          slug: `correlation-a-${suffix}`,
        },
        {
          id: secondOrganizationId,
          name: "Correlation integration B",
          slug: `correlation-b-${suffix}`,
        },
      ]);
      await database.withTenant(
        "correlation-test-user",
        firstOrganizationId,
        async (tx) => {
          await tx.insert(projects).values({
            id: firstProjectId,
            organizationId: firstOrganizationId,
            name: "Correlation project A",
            slug: `correlation-project-a-${suffix}`,
          });
          await tx.insert(environments).values([
            {
              id: productionId,
              organizationId: firstOrganizationId,
              projectId: firstProjectId,
              name: "Production",
              slug: "production",
            },
            {
              id: stagingId,
              organizationId: firstOrganizationId,
              projectId: firstProjectId,
              name: "Staging",
              slug: "staging",
            },
          ]);
          await tx.insert(telemetryEvents).values([
            {
              id: eventIds[0],
              organizationId: firstOrganizationId,
              projectId: firstProjectId,
              environmentId: productionId,
              eventType: "error",
              severity: "info",
              occurredAt: new Date(now - 10 * 60_000),
              fingerprint,
              groupingVersion: "fingerprint-v1",
              message: "Production error fixture",
              idempotencyKey: `${eventIds[0]}`,
              contentHash: "b".repeat(64),
            },
            {
              id: eventIds[1],
              organizationId: firstOrganizationId,
              projectId: firstProjectId,
              environmentId: productionId,
              eventType: "error",
              severity: "critical",
              occurredAt: new Date(now - 5 * 60_000),
              fingerprint,
              groupingVersion: "fingerprint-v1",
              message: "Production critical fixture",
              idempotencyKey: `${eventIds[1]}`,
              contentHash: "c".repeat(64),
            },
            {
              id: eventIds[2],
              organizationId: firstOrganizationId,
              projectId: firstProjectId,
              environmentId: stagingId,
              eventType: "error",
              severity: "error",
              occurredAt: new Date(now - 4 * 60_000),
              fingerprint,
              groupingVersion: "fingerprint-v1",
              message: "Staging error fixture",
              idempotencyKey: `${eventIds[2]}`,
              contentHash: "d".repeat(64),
            },
            {
              id: eventIds[4],
              organizationId: firstOrganizationId,
              projectId: firstProjectId,
              environmentId: productionId,
              eventType: "error",
              severity: "error",
              occurredAt: new Date(now - 40 * 60_000),
              fingerprint,
              groupingVersion: "fingerprint-v1",
              message: "Late production error fixture",
              idempotencyKey: `${eventIds[4]}`,
              contentHash: "f".repeat(64),
            },
            {
              id: eventIds[5],
              organizationId: firstOrganizationId,
              projectId: firstProjectId,
              environmentId: productionId,
              eventType: "error",
              severity: "error",
              occurredAt: new Date(now - 60_000),
              fingerprint,
              groupingVersion: "fingerprint-v1",
              message: "Post-resolution production error fixture",
              idempotencyKey: `${eventIds[5]}`,
              contentHash: "a".repeat(64),
            },
          ]);
        },
      );
      await database.withTenant(
        "correlation-test-user",
        secondOrganizationId,
        async (tx) => {
          await tx.insert(projects).values({
            id: secondProjectId,
            organizationId: secondOrganizationId,
            name: "Correlation project B",
            slug: `correlation-project-b-${suffix}`,
          });
          await tx.insert(environments).values({
            id: otherProductionId,
            organizationId: secondOrganizationId,
            projectId: secondProjectId,
            name: "Production",
            slug: "production",
          });
          await tx.insert(telemetryEvents).values({
            id: eventIds[3],
            organizationId: secondOrganizationId,
            projectId: secondProjectId,
            environmentId: otherProductionId,
            eventType: "error",
            severity: "error",
            occurredAt: new Date(now - 3 * 60_000),
            fingerprint,
            groupingVersion: "fingerprint-v1",
            message: "Other organization fixture",
            idempotencyKey: `${eventIds[3]}`,
            contentHash: "e".repeat(64),
          });
        },
      );

      const jobs = [
        [eventIds[0]!, firstOrganizationId, firstProjectId],
        [eventIds[1]!, firstOrganizationId, firstProjectId],
        [eventIds[2]!, firstOrganizationId, firstProjectId],
        [eventIds[3]!, secondOrganizationId, secondProjectId],
      ] as const;
      for (const [eventId, organizationId, projectId] of jobs)
        await correlateEvent(database, { eventId, organizationId, projectId });
      await correlateEvent(database, {
        eventId: eventIds[4],
        organizationId: firstOrganizationId,
        projectId: firstProjectId,
      });
      await database.withTenant(
        "correlation-test-user",
        firstOrganizationId,
        (tx) =>
          tx
            .update(incidents)
            .set({ status: "resolved", resolvedAt: new Date(now - 2 * 60_000) })
            .where(
              and(
                eq(incidents.organizationId, firstOrganizationId),
                eq(incidents.projectId, firstProjectId),
                eq(incidents.environmentId, productionId),
                eq(incidents.status, "open"),
              ),
            ),
      );
      await correlateEvent(database, {
        eventId: eventIds[5],
        organizationId: firstOrganizationId,
        projectId: firstProjectId,
      });
      await correlateEvent(database, {
        eventId: eventIds[0],
        organizationId: firstOrganizationId,
        projectId: firstProjectId,
      });

      const firstTenantIncidents = await database.withTenant(
        "correlation-test-user",
        firstOrganizationId,
        (tx) =>
          tx
            .select({
              id: incidents.id,
              environmentId: incidents.environmentId,
              severity: incidents.severity,
              eventCount: incidents.eventCount,
              status: incidents.status,
              firstSeenAt: incidents.firstSeenAt,
            })
            .from(incidents)
            .where(eq(incidents.organizationId, firstOrganizationId)),
      );
      const otherTenantIncidents = await database.withTenant(
        "correlation-test-user",
        secondOrganizationId,
        (tx) =>
          tx
            .select({
              id: incidents.id,
              environmentId: incidents.environmentId,
              severity: incidents.severity,
              eventCount: incidents.eventCount,
            })
            .from(incidents)
            .where(eq(incidents.organizationId, secondOrganizationId)),
      );
      expect(firstTenantIncidents).toHaveLength(2);
      const productionIncident = firstTenantIncidents.find(
        (incident) => incident.environmentId === productionId,
      );
      expect(productionIncident).toMatchObject({
        severity: "critical",
        eventCount: 4,
        status: "open",
        firstSeenAt: new Date(now - 40 * 60_000),
      });
      const stagingIncident = firstTenantIncidents.find(
        (incident) => incident.environmentId === stagingId,
      );
      expect(stagingIncident).toMatchObject({
        severity: "error",
        eventCount: 1,
        status: "open",
      });
      expect(otherTenantIncidents).toHaveLength(1);
      expect(otherTenantIncidents[0]).toMatchObject({
        environmentId: otherProductionId,
        severity: "error",
        eventCount: 1,
      });
      const firstTenantLinks = await database.withTenant(
        "correlation-test-user",
        firstOrganizationId,
        (tx) =>
          tx
            .select({ id: incidentEvents.id })
            .from(incidentEvents)
            .where(eq(incidentEvents.organizationId, firstOrganizationId)),
      );
      expect(firstTenantLinks).toHaveLength(5);
    } finally {
      await database.db
        .delete(organizations)
        .where(
          inArray(organizations.id, [
            firstOrganizationId,
            secondOrganizationId,
          ]),
        );
    }
  }, 30_000);

  it("enforces API-key scope, expiration, revocation, and project ownership", async () => {
    if (!database)
      throw new Error("The database integration setup did not run.");
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const valid = createProjectKey();
    const insufficient = createProjectKey();
    const expired = createProjectKey();
    const revoked = createProjectKey();
    try {
      await database.db.insert(organizations).values({
        id: organizationId,
        name: "API key integration",
        slug: `api-key-${suffix}`,
      });
      await database.withTenant(
        "api-key-test-user",
        organizationId,
        async (tx) => {
          await tx.insert(projects).values({
            id: projectId,
            organizationId,
            name: "API key project",
            slug: `api-key-project-${suffix}`,
          });
          await tx.insert(apiKeys).values([
            {
              organizationId,
              projectId,
              name: "Valid key",
              keyPrefix: valid.prefix,
              keyHash: valid.hash,
              scopes: ["events:write"],
            },
            {
              organizationId,
              projectId,
              name: "Insufficient scope key",
              keyPrefix: insufficient.prefix,
              keyHash: insufficient.hash,
              scopes: ["events:read"],
            },
            {
              organizationId,
              projectId,
              name: "Expired key",
              keyPrefix: expired.prefix,
              keyHash: expired.hash,
              scopes: ["events:write"],
              expiresAt: new Date(Date.now() - 60_000),
            },
            {
              organizationId,
              projectId,
              name: "Revoked key",
              keyPrefix: revoked.prefix,
              keyHash: revoked.hash,
              scopes: ["events:write"],
              revokedAt: new Date(),
            },
          ]);
        },
      );
      const requestFor = (plaintext: string) =>
        ({ headers: { authorization: `Bearer ${plaintext}` } }) as never;

      await expect(
        authenticateProjectKey(requestFor(valid.plaintext), database),
      ).resolves.toMatchObject({ organizationId, projectId });
      await expect(
        authenticateProjectKey(requestFor(insufficient.plaintext), database),
      ).rejects.toMatchObject({ code: "API_KEY_SCOPE_REQUIRED" });
      await expect(
        authenticateProjectKey(requestFor(expired.plaintext), database),
      ).rejects.toMatchObject({ code: "API_KEY_EXPIRED" });
      await expect(
        authenticateProjectKey(requestFor(revoked.plaintext), database),
      ).rejects.toMatchObject({ code: "API_KEY_INVALID" });
    } finally {
      await database.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  }, 30_000);

  it("rejects cross-project telemetry references and makes event retries idempotent", async () => {
    if (!database)
      throw new Error("The database integration setup did not run.");
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const otherProjectId = randomUUID();
    const otherEnvironmentId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    const valid = createProjectKey();
    const configuration = {
      MAX_EVENT_PAYLOAD_BYTES: 32_768,
      MAX_BATCH_EVENTS: 100,
      TELEMETRY_RETENTION_DAYS: 14,
    } as unknown as typeof import("../apps/api/src/config.js").config;
    let apiKeyId: string | undefined;
    try {
      await database.db.insert(organizations).values({
        id: organizationId,
        name: "Ingestion integration",
        slug: `ingestion-${suffix}`,
      });
      await database.withTenant(
        "ingestion-test-user",
        organizationId,
        async (tx) => {
          await tx.insert(projects).values([
            {
              id: projectId,
              organizationId,
              name: "Project accepting events",
              slug: `ingestion-project-a-${suffix}`,
            },
            {
              id: otherProjectId,
              organizationId,
              name: "Other project",
              slug: `ingestion-project-b-${suffix}`,
            },
          ]);
          await tx.insert(services).values({
            organizationId,
            projectId: otherProjectId,
            name: "Other checkout service",
            serviceKey: "other-checkout",
          });
          await tx.insert(environments).values({
            id: otherEnvironmentId,
            organizationId,
            projectId: otherProjectId,
            name: "Other production",
            slug: "other-production",
          });
          const [createdKey] = await tx
            .insert(apiKeys)
            .values({
              organizationId,
              projectId,
              name: "Ingestion key",
              keyPrefix: valid.prefix,
              keyHash: valid.hash,
              scopes: ["events:write"],
            })
            .returning({ id: apiKeys.id });
          apiKeyId = createdKey?.id;
        },
      );
      const key = {
        id: apiKeyId!,
        organizationId,
        projectId,
      };
      const crossProjectEvent = {
        eventType: "error",
        occurredAt: new Date().toISOString(),
        environment: "other-production",
        service: "other-checkout",
        severity: "error",
        message: "Cross-project resource reference",
      };
      await expect(
        ingestTelemetry(
          database,
          key,
          crossProjectEvent,
          "cross-project-reference",
          randomUUID(),
          configuration,
        ),
      ).rejects.toMatchObject({ code: "ENVIRONMENT_SCOPE_MISMATCH" });

      const event = {
        eventType: "error",
        occurredAt: new Date().toISOString(),
        severity: "error",
        message: "A repeated telemetry fixture",
      };
      const first = await ingestTelemetry(
        database,
        key,
        event,
        "retry-key",
        randomUUID(),
        configuration,
      );
      const replay = await ingestTelemetry(
        database,
        key,
        event,
        "retry-key",
        randomUUID(),
        configuration,
      );
      expect(first).toMatchObject({ accepted: 1, duplicates: 0 });
      expect(replay).toMatchObject({ accepted: 0, duplicates: 1 });
      expect(replay.eventIds).toEqual(first.eventIds);
      await expect(
        ingestTelemetry(
          database,
          key,
          { ...event, message: "Changed event under same key" },
          "retry-key",
          randomUUID(),
          configuration,
        ),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });

      const persisted = await database.withTenant(
        "ingestion-test-user",
        organizationId,
        (tx) =>
          tx
            .select({ id: telemetryEvents.id })
            .from(telemetryEvents)
            .where(eq(telemetryEvents.projectId, projectId)),
      );
      expect(persisted).toHaveLength(1);
      const queued = await database.pool.query<{ count: string }>(
        "SELECT count(*) FROM outbox WHERE organization_id=$1 AND topic='event.correlation'",
        [organizationId],
      );
      expect(queued.rows[0]?.count).toBe("1");
    } finally {
      await database.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
    }
  }, 30_000);

  it("cancels queued investigations without crossing the worker start transition", async () => {
    if (!database)
      throw new Error("The database integration setup did not run.");
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const incidentId = randomUUID();
    const queuedId = randomUUID();
    const runningId = randomUUID();
    const racingId = randomUUID();
    const actorUserId = `cancel-test-${randomUUID()}`;
    const suffix = randomUUID().slice(0, 8);
    const requestId = randomUUID();
    const now = new Date();
    try {
      await database.db.insert(users).values({
        id: actorUserId,
        name: "Investigation cancellation integration",
        email: `${actorUserId}@example.test`,
      });
      await database.db.insert(organizations).values({
        id: organizationId,
        name: "Investigation cancellation integration",
        slug: `cancel-investigation-${suffix}`,
      });
      await database.withTenant(actorUserId, organizationId, async (tx) => {
        await tx.insert(projects).values({
          id: projectId,
          organizationId,
          name: "Cancellation project",
          slug: `cancel-${suffix}`,
        });
        await tx.insert(incidents).values({
          id: incidentId,
          organizationId,
          projectId,
          fingerprint: randomUUID(),
          groupingVersion: "v1",
          title: "Cancellation integration incident",
          status: "open",
          severity: "error",
          firstSeenAt: now,
          lastSeenAt: now,
        });
        await tx.insert(investigations).values(
          [queuedId, runningId, racingId].map((id) => ({
            id,
            organizationId,
            incidentId,
            status: "queued",
            provider: "mock",
            model: "integration-test",
            promptVersion: "test-v1",
            createdBy: actorUserId,
          })),
        );
      });

      const cancellation = await cancelQueuedInvestigation(database, {
        organizationId,
        investigationId: queuedId,
        actorUserId,
        requestId,
      });
      expect(cancellation).toMatchObject({
        kind: "cancelled",
        investigation: { id: queuedId, status: "cancelled" },
      });
      const workerAfterCancellation = await database.withTenant(
        "signalforge-worker",
        organizationId,
        (tx) =>
          markInvestigationRunning(tx, {
            organizationId,
            investigationId: queuedId,
          }),
      );
      expect(workerAfterCancellation).toBe(false);

      const workerStart = await database.withTenant(
        "signalforge-worker",
        organizationId,
        (tx) =>
          markInvestigationRunning(tx, {
            organizationId,
            investigationId: runningId,
          }),
      );
      expect(workerStart).toBe(true);
      const runningCancellation = await cancelQueuedInvestigation(database, {
        organizationId,
        investigationId: runningId,
        actorUserId,
        requestId,
      });
      expect(runningCancellation).toEqual({
        kind: "not_cancellable",
        status: "running",
      });

      const [raceCancellation, raceWorkerStart] = await Promise.all([
        cancelQueuedInvestigation(database, {
          organizationId,
          investigationId: racingId,
          actorUserId,
          requestId,
        }),
        database.withTenant("signalforge-worker", organizationId, (tx) =>
          markInvestigationRunning(tx, {
            organizationId,
            investigationId: racingId,
          }),
        ),
      ]);
      const [racedRow] = await database.withTenant(
        actorUserId,
        organizationId,
        (tx) =>
          tx
            .select({ status: investigations.status })
            .from(investigations)
            .where(eq(investigations.id, racingId))
            .limit(1),
      );
      if (raceCancellation.kind === "cancelled") {
        expect(raceWorkerStart).toBe(false);
        expect(racedRow?.status).toBe("cancelled");
      } else {
        expect(raceCancellation).toEqual({
          kind: "not_cancellable",
          status: "running",
        });
        expect(raceWorkerStart).toBe(true);
        expect(racedRow?.status).toBe("running");
      }

      const foreignTenantLookup = await cancelQueuedInvestigation(database, {
        organizationId: randomUUID(),
        investigationId: queuedId,
        actorUserId,
        requestId,
      });
      expect(foreignTenantLookup).toEqual({ kind: "missing" });
      const auditRows = await database.withTenant(
        actorUserId,
        organizationId,
        (tx) =>
          tx
            .select({
              action: auditLogs.action,
              resourceId: auditLogs.resourceId,
            })
            .from(auditLogs)
            .where(eq(auditLogs.organizationId, organizationId)),
      );
      expect(auditRows).toContainEqual({
        action: "investigation.cancelled",
        resourceId: queuedId,
      });
      expect(auditRows.some((row) => row.resourceId === runningId)).toBe(false);
    } finally {
      await database.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await database.db.delete(users).where(eq(users.id, actorUserId));
    }
  }, 30_000);

  it("retries eligible failed investigations once with a durable outbox item", async () => {
    if (!database)
      throw new Error("The database integration setup did not run.");
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const incidentId = randomUUID();
    const retryId = randomUUID();
    const raceId = randomUUID();
    const permanentFailureId = randomUUID();
    const retryLimitId = randomUUID();
    const actorUserId = `retry-test-${randomUUID()}`;
    const suffix = randomUUID().slice(0, 8);
    const requestId = randomUUID();
    const now = new Date();
    try {
      await database.db.insert(users).values({
        id: actorUserId,
        name: "Investigation retry integration",
        email: `${actorUserId}@example.test`,
      });
      await database.db.insert(organizations).values({
        id: organizationId,
        name: "Investigation retry integration",
        slug: `retry-investigation-${suffix}`,
      });
      await database.withTenant(actorUserId, organizationId, async (tx) => {
        await tx.insert(projects).values({
          id: projectId,
          organizationId,
          name: "Retry project",
          slug: `retry-${suffix}`,
        });
        await tx.insert(incidents).values({
          id: incidentId,
          organizationId,
          projectId,
          fingerprint: randomUUID(),
          groupingVersion: "v1",
          title: "Retry integration incident",
          status: "open",
          severity: "error",
          firstSeenAt: now,
          lastSeenAt: now,
        });
        await tx.insert(investigations).values(
          [retryId, raceId, retryLimitId].map((id) => ({
            id,
            organizationId,
            incidentId,
            status: "failed",
            provider: "mock",
            model: "integration-test",
            promptVersion: "test-v1",
            errorCode: "JOB_RETRIES_EXHAUSTED",
            createdBy: actorUserId,
          })),
        );
        await tx.insert(investigations).values({
          id: permanentFailureId,
          organizationId,
          incidentId,
          status: "failed",
          provider: "mock",
          model: "integration-test",
          promptVersion: "test-v1",
          errorCode: "INVALID_PROVIDER_OUTPUT",
          createdBy: actorUserId,
        });
        await tx.insert(auditLogs).values(
          Array.from({ length: 3 }, () => ({
            organizationId,
            actorUserId,
            action: "investigation.retry_requested",
            resourceType: "investigation",
            resourceId: retryLimitId,
            requestId,
            metadata: { retryNumber: 1 },
          })),
        );
      });

      const retried = await retryFailedInvestigation(database, {
        organizationId,
        investigationId: retryId,
        actorUserId,
        requestId,
      });
      expect(retried).toEqual({
        kind: "queued",
        investigation: { id: retryId, status: "queued" },
      });
      const duplicateRetry = await retryFailedInvestigation(database, {
        organizationId,
        investigationId: retryId,
        actorUserId,
        requestId,
      });
      expect(duplicateRetry).toMatchObject({
        kind: "not_retryable",
        status: "queued",
      });

      const [firstRaceResult, secondRaceResult] = await Promise.all([
        retryFailedInvestigation(database, {
          organizationId,
          investigationId: raceId,
          actorUserId,
          requestId,
        }),
        retryFailedInvestigation(database, {
          organizationId,
          investigationId: raceId,
          actorUserId,
          requestId,
        }),
      ]);
      expect(
        [firstRaceResult, secondRaceResult].filter(
          (result) => result.kind === "queued",
        ),
      ).toHaveLength(1);
      expect(
        [firstRaceResult, secondRaceResult].filter(
          (result) =>
            result.kind === "not_retryable" && result.status === "queued",
        ),
      ).toHaveLength(1);

      const permanentFailureRetry = await retryFailedInvestigation(database, {
        organizationId,
        investigationId: permanentFailureId,
        actorUserId,
        requestId,
      });
      expect(permanentFailureRetry).toEqual({
        kind: "not_retryable",
        status: "failed",
        errorCode: "INVALID_PROVIDER_OUTPUT",
      });
      const exhaustedManualRetry = await retryFailedInvestigation(database, {
        organizationId,
        investigationId: retryLimitId,
        actorUserId,
        requestId,
      });
      expect(exhaustedManualRetry).toEqual({ kind: "retry_limit" });
      const foreignTenantLookup = await retryFailedInvestigation(database, {
        organizationId: randomUUID(),
        investigationId: retryId,
        actorUserId,
        requestId,
      });
      expect(foreignTenantLookup).toEqual({ kind: "missing" });

      const retryRows = await database.withTenant(
        actorUserId,
        organizationId,
        (tx) =>
          tx
            .select({ topic: outbox.topic, payload: outbox.payload })
            .from(outbox)
            .where(
              and(
                eq(outbox.organizationId, organizationId),
                eq(outbox.topic, "investigation.run"),
              ),
            ),
      );
      expect(
        retryRows.filter((row) => row.payload.investigationId === retryId),
      ).toHaveLength(1);
      expect(
        retryRows.filter((row) => row.payload.investigationId === raceId),
      ).toHaveLength(1);
      const retryAudits = await database.withTenant(
        actorUserId,
        organizationId,
        (tx) =>
          tx
            .select({
              action: auditLogs.action,
              resourceId: auditLogs.resourceId,
            })
            .from(auditLogs)
            .where(
              and(
                eq(auditLogs.organizationId, organizationId),
                eq(auditLogs.action, "investigation.retry_requested"),
              ),
            ),
      );
      expect(
        retryAudits.filter((row) => row.resourceId === retryId),
      ).toHaveLength(1);
      expect(
        retryAudits.filter((row) => row.resourceId === raceId),
      ).toHaveLength(1);
    } finally {
      await database.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await database.db.delete(users).where(eq(users.id, actorUserId));
    }
  }, 30_000);
});
