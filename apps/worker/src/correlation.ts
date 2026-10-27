import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { createDatabase } from "@signalforge/db";
import {
  auditLogs,
  incidentEvents,
  incidents,
  telemetryEvents,
} from "@signalforge/db";
import { incidentSeverityFrom, redactText } from "@signalforge/domain";

type DatabaseHandle = ReturnType<typeof createDatabase>;

const eventJobSchema = z
  .object({
    eventId: z.string().uuid(),
    projectId: z.string().uuid(),
    organizationId: z.string().uuid(),
    requestId: z.string().max(100).optional(),
  })
  .strict();

function moreSevere(current: string, next: string): string {
  const levels: Record<string, number> = {
    info: 0,
    warning: 1,
    error: 2,
    critical: 3,
  };
  return (levels[next] ?? 0) > (levels[current] ?? 0) ? next : current;
}

export async function correlateEvent(
  database: DatabaseHandle,
  raw: unknown,
): Promise<void> {
  const job = eventJobSchema.parse(raw);
  await database.withTenant(
    "signalforge-worker",
    job.organizationId,
    async (tx) => {
      const [event] = await tx
        .select()
        .from(telemetryEvents)
        .where(
          and(
            eq(telemetryEvents.id, job.eventId),
            eq(telemetryEvents.organizationId, job.organizationId),
            eq(telemetryEvents.projectId, job.projectId),
          ),
        )
        .limit(1);
      if (
        !event ||
        (event.eventType !== "error" &&
          event.severity !== "error" &&
          event.severity !== "critical")
      )
        return;
      const lockKey = `${event.organizationId}/${event.projectId}/${event.environmentId ?? "none"}/${event.fingerprint ?? event.id}`;
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );
      const [existingLink] = await tx
        .select({ id: incidentEvents.id })
        .from(incidentEvents)
        .where(
          and(
            eq(incidentEvents.organizationId, job.organizationId),
            eq(incidentEvents.telemetryEventId, event.id),
          ),
        )
        .limit(1);
      if (existingLink) return;

      const environmentFilter = event.environmentId
        ? eq(incidents.environmentId, event.environmentId)
        : isNull(incidents.environmentId);
      const groupingBoundary = new Date(
        event.occurredAt.getTime() - 60 * 60 * 1000,
      );
      const common = [
        eq(incidents.organizationId, event.organizationId),
        eq(incidents.projectId, event.projectId),
        eq(incidents.fingerprint, event.fingerprint ?? ""),
        environmentFilter,
        gte(incidents.lastSeenAt, groupingBoundary),
      ];
      const active = await tx
        .select()
        .from(incidents)
        .where(
          and(
            ...common,
            inArray(incidents.status, ["open", "investigating", "monitoring"]),
          ),
        )
        .orderBy(desc(incidents.lastSeenAt))
        .limit(1);
      const activeIncident = active[0];
      let incidentId: string;
      let linkType = "event_received";
      if (activeIncident) {
        incidentId = activeIncident.id;
        await tx
          .update(incidents)
          .set({
            firstSeenAt: sql`least(${incidents.firstSeenAt}, ${event.occurredAt})`,
            lastSeenAt: sql`greatest(${incidents.lastSeenAt}, ${event.occurredAt})`,
            eventCount: sql`${incidents.eventCount} + 1`,
            severity: moreSevere(
              activeIncident.severity,
              incidentSeverityFrom(event.eventType, event.severity),
            ),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(incidents.id, activeIncident.id),
              eq(incidents.organizationId, job.organizationId),
            ),
          );
      } else {
        const resolved = await tx
          .select()
          .from(incidents)
          .where(and(...common, eq(incidents.status, "resolved")))
          .orderBy(desc(incidents.resolvedAt))
          .limit(1);
        const recentResolved = resolved[0];
        if (recentResolved) {
          incidentId = recentResolved.id;
          linkType = "incident_reopened";
          await tx
            .update(incidents)
            .set({
              status: "open",
              resolvedAt: null,
              lastSeenAt:
                event.occurredAt > recentResolved.lastSeenAt
                  ? event.occurredAt
                  : recentResolved.lastSeenAt,
              firstSeenAt:
                event.occurredAt < recentResolved.firstSeenAt
                  ? event.occurredAt
                  : recentResolved.firstSeenAt,
              eventCount: sql`${incidents.eventCount} + 1`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(incidents.id, recentResolved.id),
                eq(incidents.organizationId, job.organizationId),
              ),
            );
        } else {
          const [created] = await tx
            .insert(incidents)
            .values({
              organizationId: event.organizationId,
              projectId: event.projectId,
              environmentId: event.environmentId,
              fingerprint: event.fingerprint ?? event.contentHash ?? event.id,
              groupingVersion: event.groupingVersion ?? "fingerprint-v1",
              title: redactText(event.message).slice(0, 180),
              status: "open",
              severity: incidentSeverityFrom(event.eventType, event.severity),
              firstSeenAt: event.occurredAt,
              lastSeenAt: event.occurredAt,
              eventCount: 1,
            })
            .returning({ id: incidents.id });
          if (!created) throw new Error("INCIDENT_CREATE_FAILED");
          incidentId = created.id;
          await tx.insert(auditLogs).values({
            organizationId: job.organizationId,
            actorUserId: null,
            action: "incident.created",
            resourceType: "incident",
            resourceId: incidentId,
            requestId: job.requestId ?? null,
            metadata: {
              groupingVersion: event.groupingVersion ?? "fingerprint-v1",
            },
          });
        }
      }
      await tx
        .insert(incidentEvents)
        .values({
          organizationId: job.organizationId,
          incidentId,
          telemetryEventId: event.id,
          eventType: linkType,
          payload: { eventId: event.id },
        })
        .onConflictDoNothing();
      if (linkType === "incident_reopened")
        await tx.insert(auditLogs).values({
          organizationId: job.organizationId,
          actorUserId: null,
          action: "incident.reopened",
          resourceType: "incident",
          resourceId: incidentId,
          requestId: job.requestId ?? null,
          metadata: { eventId: event.id },
        });
    },
  );
}
