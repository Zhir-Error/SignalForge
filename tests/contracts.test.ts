import { describe, expect, it } from "vitest";
import {
  investigationResultSchema,
  invitationInputSchema,
  telemetryEventSchema,
  verificationRequestSchema,
} from "../packages/contracts/src/index.js";

describe("shared contracts", () => {
  it("applies safe telemetry defaults and rejects unknown properties", () => {
    const event = telemetryEventSchema.parse({
      eventType: "error",
      occurredAt: "2026-01-01T00:00:00.000Z",
      message: "database failure",
    });
    expect(event.severity).toBe("info");
    expect(event.attributes).toEqual({});
    expect(
      telemetryEventSchema.safeParse({ ...event, rawSql: "select *" }).success,
    ).toBe(false);
  });

  it("does not permit invitations to grant owner role directly", () => {
    expect(
      invitationInputSchema.safeParse({
        email: " A@Example.com ",
        role: "member",
      }).success,
    ).toBe(true);
    expect(
      invitationInputSchema.safeParse({ email: "a@example.com", role: "owner" })
        .success,
    ).toBe(false);
  });

  it("limits verification to registered scenarios", () => {
    expect(
      verificationRequestSchema.safeParse({ scenarioKey: "recovery-check" })
        .success,
    ).toBe(true);
    expect(
      verificationRequestSchema.safeParse({ scenarioKey: "run-shell" }).success,
    ).toBe(false);
  });

  it("rejects malformed structured investigation output", () => {
    expect(
      investigationResultSchema.safeParse({
        summary: "ok",
        hypotheses: [],
        limitations: [],
        toolCall: "execute",
      }).success,
    ).toBe(false);
  });
});
