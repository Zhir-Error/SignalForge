import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  auditLogs,
  evidenceItems,
  incidentEvents,
  incidents,
  investigations,
  organizations,
  telemetryEvents,
} from "@signalforge/db";
import type { createDatabase } from "@signalforge/db";

type WorkerDatabase = ReturnType<typeof createDatabase>;

export async function purgeExpiredTelemetry(
  database: WorkerDatabase,
  retentionDays: number,
): Promise<void> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const tenantRows = await database.db
    .select({ id: organizations.id })
    .from(organizations);

  for (const tenant of tenantRows) {
    for (let batch = 0; batch < 20; batch += 1) {
      const removed = await database.withTenant(
        "signalforge-retention",
        tenant.id,
        async (tx) => {
          const oldEvents = await tx
            .select({ id: telemetryEvents.id })
            .from(telemetryEvents)
            .where(
              and(
                eq(telemetryEvents.organizationId, tenant.id),
                lt(telemetryEvents.occurredAt, cutoff),
              ),
            )
            .orderBy(asc(telemetryEvents.occurredAt))
            .limit(500);
          const eventIds = oldEvents.map((event) => event.id);
          if (eventIds.length === 0) return 0;

          const links = await tx
            .select({ incidentId: incidentEvents.incidentId })
            .from(incidentEvents)
            .where(
              and(
                eq(incidentEvents.organizationId, tenant.id),
                inArray(incidentEvents.telemetryEventId, eventIds),
              ),
            );
          const affectedIncidentIds = [
            ...new Set(links.map((link) => link.incidentId)),
          ];
          const evidenceRows = await tx
            .select({ investigationId: evidenceItems.investigationId })
            .from(evidenceItems)
            .where(
              and(
                eq(evidenceItems.organizationId, tenant.id),
                eq(evidenceItems.sourceType, "telemetry_event"),
                inArray(evidenceItems.sourceRef, eventIds),
              ),
            );
          const investigationIds = [
            ...new Set(evidenceRows.map((row) => row.investigationId)),
          ];
          if (investigationIds.length > 0) {
            const completed = await tx
              .select({ id: investigations.id })
              .from(investigations)
              .where(
                and(
                  eq(investigations.organizationId, tenant.id),
                  inArray(investigations.id, investigationIds),
                  inArray(investigations.status, [
                    "completed",
                    "failed",
                    "cancelled",
                  ]),
                ),
              );
            const completedIds = completed.map((row) => row.id);
            if (completedIds.length > 0)
              await tx
                .delete(investigations)
                .where(
                  and(
                    eq(investigations.organizationId, tenant.id),
                    inArray(investigations.id, completedIds),
                  ),
                );
          }
          await tx
            .delete(incidentEvents)
            .where(
              and(
                eq(incidentEvents.organizationId, tenant.id),
                inArray(incidentEvents.telemetryEventId, eventIds),
              ),
            );
          await tx
            .delete(telemetryEvents)
            .where(
              and(
                eq(telemetryEvents.organizationId, tenant.id),
                inArray(telemetryEvents.id, eventIds),
              ),
            );
          for (const incidentId of affectedIncidentIds) {
            const [count] = await tx
              .select({ value: sql<number>`count(*)::int` })
              .from(incidentEvents)
              .where(
                and(
                  eq(incidentEvents.organizationId, tenant.id),
                  eq(incidentEvents.incidentId, incidentId),
                  sql`${incidentEvents.telemetryEventId} is not null`,
                ),
              );
            await tx
              .update(incidents)
              .set({ eventCount: count?.value ?? 0, updatedAt: new Date() })
              .where(
                and(
                  eq(incidents.organizationId, tenant.id),
                  eq(incidents.id, incidentId),
                ),
              );
          }
          await tx.insert(auditLogs).values({
            organizationId: tenant.id,
            actorUserId: null,
            action: "telemetry.retention_purged",
            resourceType: "telemetry",
            requestId: null,
            metadata: {
              deletedEvents: eventIds.length,
              cutoff: cutoff.toISOString(),
              retentionDays,
            },
          });
          return eventIds.length;
        },
      );
      if (removed === 0) break;
    }
  }
}
