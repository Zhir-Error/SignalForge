import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { validateInvestigationCitations } from "../packages/domain/src/index.js";

interface EvaluationCase {
  id: string;
  description: string;
  evidence: Array<{ id: string }>;
  allowedEvidenceIds: string[];
  plausibleHypotheses: string[];
  expectedLimitations: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isEvaluationCase(value: unknown): value is EvaluationCase {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    typeof value.description !== "string" ||
    !isStringArray(value.allowedEvidenceIds) ||
    !isStringArray(value.plausibleHypotheses) ||
    !isStringArray(value.expectedLimitations) ||
    !Array.isArray(value.evidence)
  )
    return false;
  return value.evidence.every(
    (item) => isRecord(item) && typeof item.id === "string",
  );
}

function parseEvaluationCases(raw: unknown): EvaluationCase[] {
  if (!Array.isArray(raw) || !raw.every(isEvaluationCase))
    throw new Error("Invalid synthetic AI evaluation fixture.");
  return raw;
}

describe("synthetic AI evaluation cases", () => {
  it("keeps allowed evidence IDs aligned with each fixture's evidence set", async () => {
    const raw: unknown = JSON.parse(
      await readFile(
        new URL("./fixtures/investigation-evaluation.json", import.meta.url),
        "utf8",
      ),
    );
    const cases = parseEvaluationCases(raw);

    expect(new Set(cases.map((item) => item.id)).size).toBe(cases.length);
    for (const item of cases) {
      const ids = item.evidence.map((evidence) => evidence.id);
      expect(new Set(ids)).toEqual(new Set(item.allowedEvidenceIds));
      expect(
        validateInvestigationCitations(
          {
            summary: "A synthetic hypothesis with an allowed citation.",
            hypotheses: [
              {
                claim: item.plausibleHypotheses[0] ?? "Unknown",
                rationale:
                  "This is a fixture validation, not an evaluated result.",
                confidence: "low",
                supportingEvidenceIds: [item.allowedEvidenceIds[0]!],
                contradictingEvidenceIds: [],
                proposedCheck: null,
              },
            ],
            limitations: item.expectedLimitations.slice(0, 1),
          },
          new Set(item.allowedEvidenceIds),
        ).hypotheses,
      ).toHaveLength(1);
    }
  });

  it("rejects a citation outside the fixture's investigation evidence set", async () => {
    const raw: unknown = JSON.parse(
      await readFile(
        new URL("./fixtures/investigation-evaluation.json", import.meta.url),
        "utf8",
      ),
    );
    const [first] = parseEvaluationCases(raw);
    if (!first) throw new Error("AI evaluation fixture is empty.");

    expect(() =>
      validateInvestigationCitations(
        {
          summary: "An invalid fixture citation.",
          hypotheses: [
            {
              claim: "Unsupported reference",
              rationale: "The reference is deliberately outside this case.",
              confidence: "low",
              supportingEvidenceIds: ["00000000-0000-4000-8000-000000000099"],
              contradictingEvidenceIds: [],
              proposedCheck: null,
            },
          ],
          limitations: [],
        },
        new Set(first.allowedEvidenceIds),
      ),
    ).toThrow("INVALID_EVIDENCE_REFERENCE");
  });
});
