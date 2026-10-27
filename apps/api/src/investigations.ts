import { and, eq, inArray } from "drizzle-orm";
import { auditLogs, incidents, investigations, outbox } from "@signalforge/db";
import type { DatabaseHandle } from "./security.js";

const retryableFailureCodes = [
  "JOB_RETRIES_EXHAUSTED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
] as const;
const maxManualRetries = 3;

export type InvestigationCancellationResult =
  | {
      kind: "cancelled";
      investigation: {
        id: string;
        status: string;
        finishedAt: Date;
      };
    }
  | { kind: "not_cancellable"; status: string }
  | { kind: "missing" };

export async function cancelQueuedInvestigation(
  database: DatabaseHandle,
  input: {
    organizationId: string;
    investigationId: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<InvestigationCancellationResult> {
  return database.withTenant(
    input.actorUserId,
    input.organizationId,
    async (tx) => {
      const finishedAt = new Date();
      const [cancelled] = await tx
        .update(investigations)
        .set({
          status: "cancelled",
          errorCode: "CANCELLED_BY_USER",
          finishedAt,
          updatedAt: finishedAt,
        })
        .where(
          and(
            eq(investigations.id, input.investigationId),
            eq(investigations.organizationId, input.organizationId),
            eq(investigations.status, "queued"),
          ),
        )
        .returning({ id: investigations.id, status: investigations.status });

      if (cancelled) {
        await tx.insert(auditLogs).values({
          organizationId: input.organizationId,
          actorUserId: input.actorUserId,
          action: "investigation.cancelled",
          resourceType: "investigation",
          resourceId: input.investigationId,
          requestId: input.requestId,
          metadata: { from: "queued", to: "cancelled" },
        });
        return {
          kind: "cancelled",
          investigation: { ...cancelled, finishedAt },
        };
      }

      const [existing] = await tx
        .select({ status: investigations.status })
        .from(investigations)
        .where(
          and(
            eq(investigations.id, input.investigationId),
            eq(investigations.organizationId, input.organizationId),
          ),
        )
        .limit(1);
      return existing
        ? { kind: "not_cancellable", status: existing.status }
        : { kind: "missing" };
    },
  );
}

export type InvestigationRetryResult =
  | { kind: "queued"; investigation: { id: string; status: "queued" } }
  | { kind: "not_retryable"; status: string; errorCode: string | null }
  | { kind: "retry_limit" }
  | { kind: "missing" };

export async function retryFailedInvestigation(
  database: DatabaseHandle,
  input: {
    organizationId: string;
    investigationId: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<InvestigationRetryResult> {
  return database.withTenant(
    input.actorUserId,
    input.organizationId,
    async (tx) => {
      const [existing] = await tx
        .select({
          id: investigations.id,
          incidentId: investigations.incidentId,
          status: investigations.status,
          errorCode: investigations.errorCode,
        })
        .from(investigations)
        .where(
          and(
            eq(investigations.id, input.investigationId),
            eq(investigations.organizationId, input.organizationId),
          ),
        )
        .limit(1);
      if (!existing) return { kind: "missing" };
      if (
        existing.status !== "failed" ||
        !retryableFailureCodes.includes(
          existing.errorCode as (typeof retryableFailureCodes)[number],
        )
      )
        return {
          kind: "not_retryable",
          status: existing.status,
          errorCode: existing.errorCode,
        };

      const priorRetries = await tx
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, input.organizationId),
            eq(auditLogs.resourceType, "investigation"),
            eq(auditLogs.resourceId, input.investigationId),
            eq(auditLogs.action, "investigation.retry_requested"),
          ),
        )
        .limit(maxManualRetries);
      if (priorRetries.length >= maxManualRetries)
        return { kind: "retry_limit" };

      const [incident] = await tx
        .select({ id: incidents.id, projectId: incidents.projectId })
        .from(incidents)
        .where(
          and(
            eq(incidents.id, existing.incidentId),
            eq(incidents.organizationId, input.organizationId),
          ),
        )
        .limit(1);
      if (!incident)
        return {
          kind: "not_retryable",
          status: existing.status,
          errorCode: "INCIDENT_NOT_FOUND",
        };

      const now = new Date();
      const [queued] = await tx
        .update(investigations)
        .set({
          status: "queued",
          errorCode: null,
          startedAt: null,
          finishedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(investigations.id, input.investigationId),
            eq(investigations.organizationId, input.organizationId),
            eq(investigations.status, "failed"),
            inArray(investigations.errorCode, [...retryableFailureCodes]),
          ),
        )
        .returning({ id: investigations.id });
      if (!queued) {
        const [current] = await tx
          .select({
            status: investigations.status,
            errorCode: investigations.errorCode,
          })
          .from(investigations)
          .where(
            and(
              eq(investigations.id, input.investigationId),
              eq(investigations.organizationId, input.organizationId),
            ),
          )
          .limit(1);
        return current
          ? {
              kind: "not_retryable",
              status: current.status,
              errorCode: current.errorCode,
            }
          : { kind: "missing" };
      }

      await tx.insert(outbox).values({
        organizationId: input.organizationId,
        topic: "investigation.run",
        payload: {
          investigationId: existing.id,
          incidentId: existing.incidentId,
          projectId: incident.projectId,
          organizationId: input.organizationId,
        },
      });
      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "investigation.retry_requested",
        resourceType: "investigation",
        resourceId: input.investigationId,
        requestId: input.requestId,
        metadata: {
          previousErrorCode: existing.errorCode,
          retryNumber: priorRetries.length + 1,
        },
      });
      return {
        kind: "queued",
        investigation: { id: queued.id, status: "queued" },
      };
    },
  );
}
