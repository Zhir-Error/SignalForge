import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  eventTypeSchema,
  telemetryBatchSchema,
  telemetryEventSchema,
  type TelemetryEventInput,
} from "@signalforge/contracts";
import {
  fingerprintEvent,
  incidentSeverity,
  redactAttributes,
  redactText,
} from "@signalforge/domain";
import {
  apiKeys,
  environments,
  outbox,
  services,
  telemetryEvents,
} from "@signalforge/db";
import type { ApiKeyContext } from "./key-auth.js";
import type { config } from "./config.js";
import type { DatabaseHandle } from "./security.js";
import { ApiError } from "./security.js";

type Configuration = typeof config;

function parseEventBody(
  body: unknown,
  maxCount: number,
): TelemetryEventInput[] {
  if (typeof body === "object" && body !== null && "events" in body) {
    const result = telemetryBatchSchema.safeParse(body);
    if (!result.success || result.data.events.length > maxCount)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "The event batch is invalid or exceeds the configured limit.",
      );
    return result.data.events;
  }
  const result = telemetryEventSchema.safeParse(body);
  if (!result.success)
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "The event payload is invalid.",
    );
  return [result.data];
}

export async function ingestTelemetry(
  database: DatabaseHandle,
  key: ApiKeyContext,
  body: unknown,
  idempotencyHeader: string | undefined,
  requestId: string,
  configuration: Configuration,
): Promise<{
  accepted: number;
  duplicates: number;
  eventIds: string[];
  ingestedAt: string;
}> {
  const bytes = Buffer.byteLength(JSON.stringify(body ?? null), "utf8");
  if (bytes > configuration.MAX_EVENT_PAYLOAD_BYTES)
    throw new ApiError(
      413,
      "PAYLOAD_TOO_LARGE",
      "The event payload exceeds the configured size limit.",
    );
  if (
    !idempotencyHeader ||
    idempotencyHeader.length < 1 ||
    idempotencyHeader.length > 200
  )
    throw new ApiError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "Provide an Idempotency-Key header up to 200 characters.",
    );
  const events = parseEventBody(body, configuration.MAX_BATCH_EVENTS);
  const now = new Date();
  const oldestAllowed =
    now.getTime() -
    configuration.TELEMETRY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const event of events) {
    const occurred = new Date(event.occurredAt).getTime();
    if (occurred > now.getTime() + 5 * 60_000 || occurred < oldestAllowed)
      throw new ApiError(
        400,
        "TIMESTAMP_OUT_OF_RANGE",
        "Event timestamps must be recent and cannot be more than five minutes in the future.",
      );
    if (Object.keys(event.attributes).length > 50)
      throw new ApiError(
        400,
        "ATTRIBUTES_TOO_LARGE",
        "An event may contain at most 50 attributes.",
      );
    if (!eventTypeSchema.safeParse(event.eventType).success)
      throw new ApiError(400, "VALIDATION_ERROR", "Unsupported event type.");
  }

  return database.withTenant(
    "project-api-key",
    key.organizationId,
    async (tx) => {
      const acceptedIds: string[] = [];
      let accepted = 0;
      let duplicates = 0;
      for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        if (!event) continue;
        const environment = event.environment
          ? (
              await tx
                .select({ id: environments.id, slug: environments.slug })
                .from(environments)
                .where(
                  and(
                    eq(environments.organizationId, key.organizationId),
                    eq(environments.projectId, key.projectId),
                    eq(environments.slug, event.environment),
                  ),
                )
                .limit(1)
            )[0]
          : undefined;
        const service = event.service
          ? (
              await tx
                .select({ id: services.id, serviceKey: services.serviceKey })
                .from(services)
                .where(
                  and(
                    eq(services.organizationId, key.organizationId),
                    eq(services.projectId, key.projectId),
                    eq(services.serviceKey, event.service),
                  ),
                )
                .limit(1)
            )[0]
          : undefined;
        if (event.environment && !environment)
          throw new ApiError(
            400,
            "ENVIRONMENT_SCOPE_MISMATCH",
            "The event environment is not registered for this project.",
          );
        if (event.service && !service)
          throw new ApiError(
            400,
            "SERVICE_SCOPE_MISMATCH",
            "The event service is not registered for this project.",
          );

        const safeMessage = redactText(event.message);
        const safeAttributes = redactAttributes(event.attributes);
        const canonical = JSON.stringify({
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          service: service?.serviceKey ?? null,
          environment: environment?.slug ?? null,
          severity: event.severity,
          message: safeMessage,
          attributes: safeAttributes,
        });
        const contentHash = createHash("sha256")
          .update(canonical)
          .digest("hex");
        const idempotencyKey = createHash("sha256")
          .update(`${idempotencyHeader}\u001f${index}`)
          .digest("hex");
        const fingerprint = fingerprintEvent(
          { ...event, message: safeMessage, attributes: safeAttributes },
          service?.serviceKey ?? "unknown-service",
          environment?.slug ?? "unknown-environment",
        );
        const [created] = await tx
          .insert(telemetryEvents)
          .values({
            organizationId: key.organizationId,
            projectId: key.projectId,
            environmentId: environment?.id ?? null,
            serviceId: service?.id ?? null,
            eventType: event.eventType,
            severity: event.severity,
            occurredAt: new Date(event.occurredAt),
            traceId: event.traceId ?? null,
            spanId: event.spanId ?? null,
            fingerprint,
            groupingVersion: "fingerprint-v1",
            message: safeMessage,
            attributes: safeAttributes,
            idempotencyKey,
            contentHash,
          })
          .onConflictDoNothing()
          .returning({ id: telemetryEvents.id });

        if (!created) {
          const [existing] = await tx
            .select({
              id: telemetryEvents.id,
              contentHash: telemetryEvents.contentHash,
            })
            .from(telemetryEvents)
            .where(
              and(
                eq(telemetryEvents.organizationId, key.organizationId),
                eq(telemetryEvents.projectId, key.projectId),
                eq(telemetryEvents.idempotencyKey, idempotencyKey),
              ),
            )
            .limit(1);
          if (!existing) throw new Error("IDEMPOTENCY_CONFLICT_UNRESOLVED");
          if (existing.contentHash !== contentHash)
            throw new ApiError(
              409,
              "IDEMPOTENCY_KEY_REUSED",
              "This idempotency key was already used with a different event payload.",
            );
          acceptedIds.push(existing.id);
          duplicates += 1;
          continue;
        }
        acceptedIds.push(created.id);
        accepted += 1;
        await tx.insert(outbox).values({
          organizationId: key.organizationId,
          topic: "event.correlation",
          payload: {
            eventId: created.id,
            projectId: key.projectId,
            organizationId: key.organizationId,
            requestId,
          },
        });
      }
      await tx
        .update(apiKeys)
        .set({ lastUsedAt: now })
        .where(
          and(
            eq(apiKeys.id, key.id),
            eq(apiKeys.organizationId, key.organizationId),
            eq(apiKeys.projectId, key.projectId),
          ),
        );
      return {
        accepted,
        duplicates,
        eventIds: acceptedIds,
        ingestedAt: now.toISOString(),
      };
    },
  );
}

export function severityForTelemetry(event: TelemetryEventInput): string {
  return incidentSeverity(event);
}
