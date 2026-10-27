import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  incidentSeveritySchema,
  incidentStatusSchema,
} from "@signalforge/contracts";

const cursorUuid = z.string().uuid();
const cursorDate = z.string().datetime({ offset: true });

export const incidentCursorSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("incident"),
    organizationId: cursorUuid,
    projectId: cursorUuid,
    status: incidentStatusSchema.nullable(),
    severity: incidentSeveritySchema.nullable(),
    lastSeenAt: cursorDate,
    id: cursorUuid,
  })
  .strict();

export const incidentEventCursorSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("incident-event"),
    organizationId: cursorUuid,
    incidentId: cursorUuid,
    occurredAt: cursorDate,
    id: cursorUuid,
  })
  .strict();

export class InvalidCursorError extends Error {
  constructor() {
    super("INVALID_CURSOR");
  }
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`signalforge.cursor.v1:${payload}`)
    .digest("base64url");
}

export function encodeCursor(payload: object, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    "base64url",
  );
  return `${encodedPayload}.${signature(encodedPayload, secret)}`;
}

export function decodeCursor<T>(
  token: string,
  secret: string,
  schema: z.ZodType<T>,
  expectedContext: Record<string, string | null>,
): T {
  if (token.length > 2048) throw new InvalidCursorError();
  const parts = token.split(".");
  const encodedPayload = parts[0];
  const providedSignature = parts[1];
  if (
    parts.length !== 2 ||
    !encodedPayload ||
    !providedSignature ||
    !/^[A-Za-z0-9_-]{43}$/.test(providedSignature)
  )
    throw new InvalidCursorError();

  const expectedSignature = signature(encodedPayload, secret);
  const providedBytes = Buffer.from(providedSignature, "ascii");
  const expectedBytes = Buffer.from(expectedSignature, "ascii");
  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  )
    throw new InvalidCursorError();

  try {
    const decoded = Buffer.from(encodedPayload, "base64url");
    if (decoded.toString("base64url") !== encodedPayload)
      throw new InvalidCursorError();
    const parsed = schema.safeParse(JSON.parse(decoded.toString("utf8")));
    if (!parsed.success || typeof parsed.data !== "object" || !parsed.data)
      throw new InvalidCursorError();
    const value = parsed.data as Record<string, unknown>;
    if (
      Object.entries(expectedContext).some(
        ([key, expected]) => value[key] !== expected,
      )
    )
      throw new InvalidCursorError();
    return parsed.data;
  } catch (error) {
    if (error instanceof InvalidCursorError) throw error;
    throw new InvalidCursorError();
  }
}
