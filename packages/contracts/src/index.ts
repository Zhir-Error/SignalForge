import { z } from "zod";

export const membershipRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
  "viewer",
]);
export const severitySchema = z.enum([
  "debug",
  "info",
  "warning",
  "error",
  "critical",
  "unknown",
]);
export const incidentSeveritySchema = z.enum([
  "info",
  "warning",
  "error",
  "critical",
]);
export const incidentStatusSchema = z.enum([
  "open",
  "investigating",
  "monitoring",
  "resolved",
  "ignored",
]);
export const eventTypeSchema = z.enum([
  "log",
  "error",
  "trace",
  "metric",
  "custom",
]);

const shortText = (max: number) => z.string().trim().min(1).max(max);
const attributeValueSchema = z.union([
  z.string().max(1024),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const telemetryEventSchema = z
  .object({
    eventType: eventTypeSchema,
    occurredAt: z.string().datetime({ offset: true }),
    service: shortText(100)
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional(),
    environment: shortText(100)
      .regex(/^[a-zA-Z0-9._-]+$/)
      .optional(),
    severity: severitySchema.default("info"),
    traceId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{8,64}$/)
      .optional(),
    spanId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{8,32}$/)
      .optional(),
    message: shortText(4096),
    attributes: z.record(z.string().max(100), attributeValueSchema).default({}),
  })
  .strict();

export const telemetryBatchSchema = z
  .object({ events: z.array(telemetryEventSchema).min(1).max(100) })
  .strict();
export const organizationInputSchema = z
  .object({ name: shortText(100) })
  .strict();
export const projectInputSchema = z
  .object({
    name: shortText(100),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    description: z.string().max(500).optional(),
  })
  .strict();
export const projectUpdateSchema = z
  .object({
    name: shortText(100).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.name !== undefined || value.description !== undefined,
  );
export const onboardingInputSchema = z
  .object({
    organizationName: shortText(100),
    projectName: shortText(100),
    projectSlug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
export const invitationInputSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    role: z.enum(["admin", "member", "viewer"]),
  })
  .strict();
export const invitationAcceptSchema = z
  .object({ token: z.string().min(32).max(256) })
  .strict();
export const membershipUpdateSchema = z
  .object({ role: membershipRoleSchema })
  .strict();
export const environmentInputSchema = z
  .object({
    name: shortText(100),
    slug: z
      .string()
      .trim()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
export const serviceInputSchema = z
  .object({
    name: shortText(100),
    serviceKey: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .regex(/^[a-zA-Z0-9._-]+$/),
    description: z.string().max(500).optional(),
  })
  .strict();
export const deploymentInputSchema = z
  .object({
    environmentId: z.string().uuid(),
    version: shortText(120),
    commitSha: z.string().max(100).optional(),
    status: z.enum([
      "started",
      "succeeded",
      "failed",
      "rolled_back",
      "unknown",
    ]),
    deployedAt: z.string().datetime({ offset: true }),
    metadata: z.record(z.string().max(100), attributeValueSchema).default({}),
  })
  .strict();
export const apiKeyInputSchema = z
  .object({
    name: shortText(100),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
export const incidentStatusInputSchema = z
  .object({ status: incidentStatusSchema })
  .strict();
export const investigationRequestSchema = z
  .object({ mode: z.literal("evidence_based").default("evidence_based") })
  .strict();
export const verificationRequestSchema = z
  .object({
    scenarioKey: z.enum(["known-failure", "recovery-check"]),
    commitSha: z.string().max(100).optional(),
  })
  .strict();
export const verificationResultSchema = z
  .object({
    status: z.enum(["passed", "failed", "error", "timed_out"]),
    summary: z.string().max(1000),
    assertions: z
      .array(
        z
          .object({
            name: z.string().max(200),
            passed: z.boolean(),
            expected: z.string().max(500),
            actual: z.string().max(500),
          })
          .strict(),
      )
      .max(50),
    exitCode: z.number().int().nullable(),
  })
  .strict();

export const investigationResultSchema = z
  .object({
    summary: shortText(2000),
    hypotheses: z
      .array(
        z
          .object({
            claim: shortText(500),
            rationale: shortText(2000),
            confidence: z.enum(["low", "medium", "high", "unknown"]),
            supportingEvidenceIds: z.array(z.string().uuid()).max(20),
            contradictingEvidenceIds: z.array(z.string().uuid()).max(20),
            proposedCheck: z.string().max(1000).nullable(),
          })
          .strict(),
      )
      .max(5),
    limitations: z.array(shortText(500)).max(10),
  })
  .strict();

export const cursorPageSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict();

export type TelemetryEventInput = z.infer<typeof telemetryEventSchema>;
export type TelemetryBatchInput = z.infer<typeof telemetryBatchSchema>;
export type InvestigationResult = z.infer<typeof investigationResultSchema>;
export type VerificationResult = z.infer<typeof verificationResultSchema>;
export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type IncidentStatus = z.infer<typeof incidentStatusSchema>;
