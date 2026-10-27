import { createHash } from "node:crypto";
import type {
  IncidentStatus,
  InvestigationResult,
  TelemetryEventInput,
} from "@signalforge/contracts";
import { investigationResultSchema } from "@signalforge/contracts";

export const GROUPING_VERSION = "fingerprint-v1";

function normalizeMessage(message: string): string {
  return message
    .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, "<uuid>")
    .replace(/\b\d+\b/g, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500)
    .toLowerCase();
}

export function fingerprintEvent(
  event: TelemetryEventInput,
  serviceKey: string,
  environmentSlug: string,
): string {
  const errorType =
    typeof event.attributes.error_type === "string"
      ? event.attributes.error_type.slice(0, 120)
      : "";
  const route =
    typeof event.attributes.http_route === "string"
      ? event.attributes.http_route.slice(0, 200)
      : "";
  const canonical = [
    GROUPING_VERSION,
    event.eventType,
    serviceKey.toLowerCase(),
    environmentSlug.toLowerCase(),
    errorType,
    route,
    normalizeMessage(event.message),
  ].join("\u001f");
  return createHash("sha256").update(canonical).digest("hex");
}

export function incidentTitle(event: TelemetryEventInput): string {
  return (
    event.message.replace(/\s+/g, " ").trim().slice(0, 180) ||
    "Unlabelled error"
  );
}

export function incidentSeverity(
  event: TelemetryEventInput,
): "info" | "warning" | "error" | "critical" {
  return incidentSeverityFrom(event.eventType, event.severity);
}

export function incidentSeverityFrom(
  eventType: string,
  severity: string,
): "info" | "warning" | "error" | "critical" {
  if (severity === "critical") return "critical";
  if (severity === "error" || eventType === "error") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

const transitions: Record<IncidentStatus, readonly IncidentStatus[]> = {
  open: ["investigating", "ignored", "resolved"],
  investigating: ["monitoring", "ignored", "resolved"],
  monitoring: ["open", "resolved", "ignored"],
  resolved: ["open"],
  ignored: ["open"],
};

export function canTransitionIncident(
  from: IncidentStatus,
  to: IncidentStatus,
): boolean {
  return transitions[from].includes(to);
}

export function requireIncidentTransition(
  from: IncidentStatus,
  to: IncidentStatus,
): void {
  if (!canTransitionIncident(from, to))
    throw new Error(`Invalid incident status transition: ${from} -> ${to}`);
}

export function redactText(input: string): string {
  return input
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g,
      "[REDACTED_SECRET]",
    )
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(
      /(password|passwd|token|secret|api[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi,
      "$1$2[REDACTED]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]")
    .slice(0, 8000);
}

export function redactAttributes(
  attributes: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  const sensitiveName =
    /(?:password|passwd|token|secret|api[_-]?key|authorization|cookie|email|phone|ssn)/i;
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => [
      key,
      sensitiveName.test(key)
        ? "[REDACTED]"
        : typeof value === "string"
          ? redactText(value).slice(0, 1024)
          : value,
    ]),
  );
}

export function validateInvestigationCitations(
  raw: unknown,
  allowedEvidenceIds: ReadonlySet<string>,
): InvestigationResult {
  const result = investigationResultSchema.parse(raw);
  for (const hypothesis of result.hypotheses) {
    const refs = [
      ...hypothesis.supportingEvidenceIds,
      ...hypothesis.contradictingEvidenceIds,
    ];
    if (refs.some((id) => !allowedEvidenceIds.has(id)))
      throw new Error("INVALID_EVIDENCE_REFERENCE");
  }
  return result;
}

export function classifyVerificationExit(
  exitCode: number | null,
  timedOut: boolean,
  startupError: boolean,
): "passed" | "failed" | "error" | "timed_out" {
  if (timedOut) return "timed_out";
  if (startupError || exitCode === null) return "error";
  return exitCode === 0 ? "passed" : "failed";
}
