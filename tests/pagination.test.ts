import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decodeCursor,
  encodeCursor,
  incidentCursorSchema,
  InvalidCursorError,
} from "../apps/api/src/pagination.js";

const secret = "test-secret-with-enough-entropy-for-cursor-signatures";
const context = {
  organizationId: randomUUID(),
  projectId: randomUUID(),
  status: "open" as const,
  severity: "critical" as const,
};
const payload = {
  version: 1,
  kind: "incident",
  ...context,
  lastSeenAt: "2026-10-27T10:00:00.000Z",
  id: randomUUID(),
};

describe("signed pagination cursors", () => {
  it("round trips a valid cursor for the matching feed context", () => {
    const encoded = encodeCursor(payload, secret);

    expect(
      decodeCursor(encoded, secret, incidentCursorSchema, context),
    ).toEqual(payload);
  });

  it("rejects a cursor reused with different filters or tenant context", () => {
    const encoded = encodeCursor(payload, secret);

    expect(() =>
      decodeCursor(encoded, secret, incidentCursorSchema, {
        ...context,
        organizationId: randomUUID(),
      }),
    ).toThrow(InvalidCursorError);
    expect(() =>
      decodeCursor(encoded, secret, incidentCursorSchema, {
        ...context,
        status: "resolved",
      }),
    ).toThrow(InvalidCursorError);
  });

  it("rejects tampering, oversized tokens, and malformed signed payloads", () => {
    const encoded = encodeCursor(payload, secret);
    const [body, signature] = encoded.split(".");
    if (!body || !signature) throw new Error("Expected encoded cursor parts");
    const changed = `${body.slice(0, -1)}${body.endsWith("A") ? "B" : "A"}.${signature}`;

    expect(() =>
      decodeCursor(changed, secret, incidentCursorSchema, context),
    ).toThrow(InvalidCursorError);
    expect(() =>
      decodeCursor("a".repeat(2049), secret, incidentCursorSchema, context),
    ).toThrow(InvalidCursorError);

    const malformed = encodeCursor({ ...payload, extra: true }, secret);
    expect(() =>
      decodeCursor(malformed, secret, incidentCursorSchema, context),
    ).toThrow(InvalidCursorError);
  });
});
