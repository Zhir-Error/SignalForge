import { describe, expect, it } from "vitest";
import { telemetryEventSchema } from "../packages/contracts/src/index.js";
import {
  canTransitionIncident,
  classifyVerificationExit,
  fingerprintEvent,
  incidentSeverityFrom,
  redactAttributes,
  redactText,
  validateInvestigationCitations,
} from "../packages/domain/src/index.js";

describe("incident domain rules", () => {
  it("normalizes variable numbers while retaining service and environment boundaries", () => {
    const first = telemetryEventSchema.parse({
      eventType: "error",
      occurredAt: "2026-01-01T00:00:00.000Z",
      service: "checkout",
      environment: "production",
      severity: "error",
      message: "Database connection failed for order 123",
    });
    const second = telemetryEventSchema.parse({
      eventType: "error",
      occurredAt: "2026-01-01T00:01:00.000Z",
      service: "checkout",
      environment: "production",
      severity: "error",
      message: "Database connection failed for order 987",
    });
    expect(fingerprintEvent(first, "checkout", "production")).toBe(
      fingerprintEvent(second, "checkout", "production"),
    );
    expect(fingerprintEvent(first, "checkout", "production")).not.toBe(
      fingerprintEvent(second, "checkout", "staging"),
    );
  });

  it("redacts credential-like values and sensitive attribute fields", () => {
    expect(
      redactText(
        "user=person@example.com authorization: Bearer abc123 password=hunter2",
      ),
    ).toContain("[REDACTED_EMAIL]");
    expect(
      redactText(
        "user=person@example.com authorization: Bearer abc123 password=hunter2",
      ),
    ).toContain("Bearer [REDACTED]");
    expect(
      redactAttributes({
        password: "hunter2",
        email: "person@example.com",
        message: "token=abc",
      }),
    ).toEqual({
      password: "[REDACTED]",
      email: "[REDACTED]",
      message: "token=[REDACTED]",
    });
  });

  it("enforces documented incident state transitions", () => {
    expect(canTransitionIncident("open", "investigating")).toBe(true);
    expect(canTransitionIncident("resolved", "open")).toBe(true);
    expect(canTransitionIncident("resolved", "monitoring")).toBe(false);
  });

  it("keeps error event types at error severity when telemetry severity defaults to info", () => {
    expect(incidentSeverityFrom("error", "info")).toBe("error");
  });

  it("rejects AI citations outside the persisted evidence set", () => {
    const result = {
      summary: "A database host is missing.",
      hypotheses: [
        {
          claim: "Missing host configuration",
          rationale: "The error matches the observed setting.",
          confidence: "high",
          supportingEvidenceIds: ["00000000-0000-4000-8000-000000000001"],
          contradictingEvidenceIds: [],
          proposedCheck: "Restore the host.",
        },
      ],
      limitations: [],
    };
    expect(() => validateInvestigationCitations(result, new Set())).toThrow(
      "INVALID_EVIDENCE_REFERENCE",
    );
    expect(
      validateInvestigationCitations(
        result,
        new Set(["00000000-0000-4000-8000-000000000001"]),
      ).summary,
    ).toBe(result.summary);
  });

  it("classifies verification exits from actual runner outcomes", () => {
    expect(classifyVerificationExit(0, false, false)).toBe("passed");
    expect(classifyVerificationExit(1, false, false)).toBe("failed");
    expect(classifyVerificationExit(0, true, false)).toBe("timed_out");
    expect(classifyVerificationExit(null, false, true)).toBe("error");
  });
});
