import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const createdAt = () =>
  timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow();

// Better Auth's conventional PostgreSQL schema. Passwords and sessions remain owned by the auth library.
export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});
export const sessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expiresAt", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    ipAddress: text("ipAddress"),
    userAgent: text("userAgent"),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_idx").on(table.userId)],
);
export const accounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("accountId").notNull(),
    providerId: text("providerId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("accessToken"),
    refreshToken: text("refreshToken"),
    idToken: text("idToken"),
    accessTokenExpiresAt: timestamp("accessTokenExpiresAt", {
      withTimezone: true,
      mode: "date",
    }),
    refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", {
      withTimezone: true,
      mode: "date",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("account_user_idx").on(table.userId),
    uniqueIndex("account_provider_account_uq").on(
      table.providerId,
      table.accountId,
    ),
  ],
);
export const verifications = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expiresAt", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 120 }).notNull().unique(),
    plan: varchar("plan", { length: 20 }).notNull().default("free"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("organizations_id_uq").on(table.id),
    check(
      "organizations_plan_check",
      sql`${table.plan} in ('free','team','internal')`,
    ),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.userId] }),
    index("memberships_user_idx").on(table.userId, table.organizationId),
    check(
      "memberships_role_check",
      sql`${table.role} in ('owner','admin','member','viewer')`,
    ),
  ],
);

export const organizationInvitations = pgTable(
  "organization_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    unique("organization_invitations_org_id_uq").on(
      table.organizationId,
      table.id,
    ),
    index("organization_invitations_org_email_idx").on(
      table.organizationId,
      table.email,
    ),
    uniqueIndex("organization_invitations_pending_uq")
      .on(table.organizationId, table.email)
      .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
    check(
      "organization_invitations_role_check",
      sql`${table.role} in ('admin','member','viewer')`,
    ),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    description: varchar("description", { length: 500 }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("projects_org_slug_uq").on(table.organizationId, table.slug),
    unique("projects_org_id_uq").on(table.organizationId, table.id),
    index("projects_org_created_idx").on(table.organizationId, table.createdAt),
  ],
);

export const environments = pgTable(
  "environments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 80 }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("environments_project_slug_uq").on(table.projectId, table.slug),
    unique("environments_org_id_uq").on(table.organizationId, table.id),
    unique("environments_org_project_id_uq").on(
      table.organizationId,
      table.projectId,
      table.id,
    ),
    index("environments_project_idx").on(table.organizationId, table.projectId),
    foreignKey({
      name: "environments_org_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
  ],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    serviceKey: varchar("service_key", { length: 100 }).notNull(),
    description: varchar("description", { length: 500 }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("services_project_key_uq").on(
      table.projectId,
      table.serviceKey,
    ),
    unique("services_org_id_uq").on(table.organizationId, table.id),
    unique("services_org_project_id_uq").on(
      table.organizationId,
      table.projectId,
      table.id,
    ),
    index("services_project_idx").on(table.organizationId, table.projectId),
    foreignKey({
      name: "services_org_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
  ],
);

export const deployments = pgTable(
  "deployments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id").notNull(),
    version: varchar("version", { length: 120 }).notNull(),
    commitSha: varchar("commit_sha", { length: 100 }),
    status: varchar("status", { length: 20 }).notNull(),
    deployedAt: timestamp("deployed_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    recordedAt: createdAt(),
    source: varchar("source", { length: 40 }).notNull().default("manual"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    unique("deployments_org_id_uq").on(table.organizationId, table.id),
    index("deployments_environment_time_idx").on(
      table.organizationId,
      table.environmentId,
      table.deployedAt,
    ),
    check(
      "deployments_status_check",
      sql`${table.status} in ('started','succeeded','failed','rolled_back','unknown')`,
    ),
    foreignKey({
      name: "deployments_org_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "deployments_org_environment_fk",
      columns: [table.organizationId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.id],
    }).onDelete("cascade"),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    keyPrefix: varchar("key_prefix", { length: 20 }).notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: text("scopes")
      .array()
      .notNull()
      .default(sql`ARRAY['events:write']::text[]`),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("api_keys_prefix_uq").on(table.keyPrefix),
    uniqueIndex("api_keys_org_project_id_uq").on(
      table.organizationId,
      table.projectId,
      table.id,
    ),
    index("api_keys_project_active_idx")
      .on(table.organizationId, table.projectId, table.createdAt)
      .where(sql`${table.revokedAt} is null`),
    foreignKey({
      name: "api_keys_org_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
  ],
);

export const telemetryEvents = pgTable(
  "telemetry_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id"),
    serviceId: uuid("service_id"),
    eventType: varchar("event_type", { length: 20 }).notNull(),
    severity: varchar("severity", { length: 20 }).notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    ingestedAt: createdAt(),
    traceId: varchar("trace_id", { length: 64 }),
    spanId: varchar("span_id", { length: 32 }),
    fingerprint: varchar("fingerprint", { length: 64 }),
    groupingVersion: varchar("grouping_version", { length: 40 }),
    message: text("message").notNull(),
    attributes: jsonb("attributes")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    redactionVersion: varchar("redaction_version", { length: 20 })
      .notNull()
      .default("v1"),
    idempotencyKey: varchar("idempotency_key", { length: 200 }),
    contentHash: varchar("content_hash", { length: 64 }),
  },
  (table) => [
    unique("events_org_id_uq").on(table.organizationId, table.id),
    uniqueIndex("events_idempotency_uq")
      .on(table.organizationId, table.projectId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    index("events_project_time_idx").on(
      table.organizationId,
      table.projectId,
      table.occurredAt,
    ),
    index("events_fingerprint_time_idx").on(
      table.organizationId,
      table.projectId,
      table.fingerprint,
      table.environmentId,
      table.occurredAt,
    ),
    index("events_trace_idx")
      .on(table.organizationId, table.traceId)
      .where(sql`${table.traceId} is not null`),
    check(
      "telemetry_event_type_check",
      sql`${table.eventType} in ('log','error','trace','metric','custom')`,
    ),
    check(
      "telemetry_severity_check",
      sql`${table.severity} in ('debug','info','warning','error','critical','unknown')`,
    ),
    foreignKey({
      name: "events_org_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "events_org_environment_fk",
      columns: [table.organizationId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "events_org_service_fk",
      columns: [table.organizationId, table.serviceId],
      foreignColumns: [services.organizationId, services.id],
    }).onDelete("cascade"),
  ],
);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    environmentId: uuid("environment_id"),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    groupingVersion: varchar("grouping_version", { length: 40 }).notNull(),
    title: varchar("title", { length: 180 }).notNull(),
    summary: text("summary"),
    status: varchar("status", { length: 20 }).notNull().default("open"),
    severity: varchar("severity", { length: 20 }).notNull().default("warning"),
    firstSeenAt: timestamp("first_seen_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    eventCount: integer("event_count").notNull().default(1),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("incidents_org_id_uq").on(table.organizationId, table.id),
    index("incidents_status_time_idx").on(
      table.organizationId,
      table.projectId,
      table.status,
      table.lastSeenAt,
    ),
    index("incidents_project_time_idx").on(
      table.organizationId,
      table.projectId,
      table.firstSeenAt,
    ),
    uniqueIndex("incidents_open_fingerprint_uq")
      .on(
        table.organizationId,
        table.projectId,
        table.fingerprint,
        sql`coalesce(${table.environmentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      )
      .where(sql`${table.status} in ('open','investigating','monitoring')`),
    check(
      "incidents_status_check",
      sql`${table.status} in ('open','investigating','monitoring','resolved','ignored')`,
    ),
    check(
      "incidents_severity_check",
      sql`${table.severity} in ('info','warning','error','critical')`,
    ),
    check("incidents_event_count_check", sql`${table.eventCount} >= 0`),
    foreignKey({
      name: "incidents_org_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "incidents_org_environment_fk",
      columns: [table.organizationId, table.environmentId],
      foreignColumns: [environments.organizationId, environments.id],
    }).onDelete("cascade"),
  ],
);

export const incidentEvents = pgTable(
  "incident_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").notNull(),
    telemetryEventId: uuid("telemetry_event_id"),
    eventType: varchar("event_type", { length: 40 }).notNull(),
    payload: jsonb("payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index("incident_events_timeline_idx").on(
      table.organizationId,
      table.incidentId,
      table.createdAt,
    ),
    uniqueIndex("incident_events_event_uq")
      .on(table.organizationId, table.telemetryEventId)
      .where(sql`${table.telemetryEventId} is not null`),
    foreignKey({
      name: "incident_events_org_incident_fk",
      columns: [table.organizationId, table.incidentId],
      foreignColumns: [incidents.organizationId, incidents.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "incident_events_org_event_fk",
      columns: [table.organizationId, table.telemetryEventId],
      foreignColumns: [telemetryEvents.organizationId, telemetryEvents.id],
    }).onDelete("restrict"),
  ],
);

export const investigations = pgTable(
  "investigations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    provider: varchar("provider", { length: 40 }).notNull(),
    model: varchar("model", { length: 100 }).notNull(),
    promptVersion: varchar("prompt_version", { length: 40 }).notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    summary: text("summary"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: varchar("error_code", { length: 80 }),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    createdBy: text("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    unique("investigations_org_id_uq").on(table.organizationId, table.id),
    unique("investigations_org_incident_id_uq").on(
      table.organizationId,
      table.incidentId,
      table.id,
    ),
    index("investigations_incident_time_idx").on(
      table.organizationId,
      table.incidentId,
      table.createdAt,
    ),
    check(
      "investigations_status_check",
      sql`${table.status} in ('queued','running','completed','failed','cancelled')`,
    ),
    check(
      "investigations_input_tokens_check",
      sql`${table.inputTokens} is null or ${table.inputTokens} >= 0`,
    ),
    check(
      "investigations_output_tokens_check",
      sql`${table.outputTokens} is null or ${table.outputTokens} >= 0`,
    ),
    foreignKey({
      name: "investigations_org_incident_fk",
      columns: [table.organizationId, table.incidentId],
      foreignColumns: [incidents.organizationId, incidents.id],
    }).onDelete("cascade"),
  ],
);

export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    investigationId: uuid("investigation_id").notNull(),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    sourceRef: varchar("source_ref", { length: 200 }).notNull(),
    sourceOccurredAt: timestamp("source_occurred_at", {
      withTimezone: true,
      mode: "date",
    }),
    capturedAt: createdAt(),
    content: text("content").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    attributes: jsonb("attributes")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (table) => [
    unique("evidence_org_investigation_id_uq").on(
      table.organizationId,
      table.investigationId,
      table.id,
    ),
    index("evidence_investigation_idx").on(
      table.organizationId,
      table.investigationId,
      table.capturedAt,
    ),
    foreignKey({
      name: "evidence_org_investigation_fk",
      columns: [table.organizationId, table.investigationId],
      foreignColumns: [investigations.organizationId, investigations.id],
    }).onDelete("cascade"),
  ],
);

export const hypotheses = pgTable(
  "hypotheses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    investigationId: uuid("investigation_id").notNull(),
    claim: varchar("claim", { length: 500 }).notNull(),
    rationale: varchar("rationale", { length: 2000 }).notNull(),
    confidence: varchar("confidence", { length: 20 }).notNull(),
    proposedCheck: varchar("proposed_check", { length: 1000 }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    unique("hypotheses_org_investigation_id_uq").on(
      table.organizationId,
      table.investigationId,
      table.id,
    ),
    foreignKey({
      name: "hypotheses_org_investigation_fk",
      columns: [table.organizationId, table.investigationId],
      foreignColumns: [investigations.organizationId, investigations.id],
    }).onDelete("cascade"),
  ],
);

export const hypothesisEvidence = pgTable(
  "hypothesis_evidence",
  {
    organizationId: uuid("organization_id").notNull(),
    investigationId: uuid("investigation_id").notNull(),
    hypothesisId: uuid("hypothesis_id").notNull(),
    evidenceId: uuid("evidence_id").notNull(),
    relationship: varchar("relationship", { length: 20 }).notNull(),
    explanation: varchar("explanation", { length: 1000 }),
  },
  (table) => [
    primaryKey({
      columns: [table.hypothesisId, table.evidenceId, table.relationship],
    }),
    check(
      "hypothesis_evidence_relation_check",
      sql`${table.relationship} in ('supports','contradicts','context')`,
    ),
    foreignKey({
      name: "hypothesis_evidence_investigation_fk",
      columns: [
        table.organizationId,
        table.investigationId,
        table.hypothesisId,
      ],
      foreignColumns: [
        hypotheses.organizationId,
        hypotheses.investigationId,
        hypotheses.id,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "hypothesis_evidence_source_fk",
      columns: [table.organizationId, table.investigationId, table.evidenceId],
      foreignColumns: [
        evidenceItems.organizationId,
        evidenceItems.investigationId,
        evidenceItems.id,
      ],
    }).onDelete("cascade"),
  ],
);

export const testScenarios = pgTable(
  "test_scenarios",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    scenarioKey: varchar("scenario_key", { length: 80 }).notNull(),
    description: varchar("description", { length: 500 }).notNull(),
    scenarioVersion: varchar("scenario_version", { length: 40 }).notNull(),
    definition: jsonb("definition")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("scenarios_project_key_uq").on(
      table.projectId,
      table.scenarioKey,
    ),
    unique("scenarios_org_project_id_uq").on(
      table.organizationId,
      table.projectId,
      table.id,
    ),
    foreignKey({
      name: "scenarios_org_project_fk",
      columns: [table.organizationId, table.projectId],
      foreignColumns: [projects.organizationId, projects.id],
    }).onDelete("cascade"),
  ],
);

export const verificationRuns = pgTable(
  "verification_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    incidentId: uuid("incident_id").notNull(),
    scenarioId: uuid("scenario_id").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("queued"),
    commitSha: varchar("commit_sha", { length: 100 }),
    scenarioVersion: varchar("scenario_version", { length: 40 }).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    durationMs: integer("duration_ms"),
    summary: varchar("summary", { length: 1000 }),
    report: jsonb("report")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorCode: varchar("error_code", { length: 80 }),
    triggeredBy: text("triggered_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index("verification_incident_time_idx").on(
      table.organizationId,
      table.incidentId,
      table.createdAt,
    ),
    check(
      "verification_status_check",
      sql`${table.status} in ('queued','running','passed','failed','error','timed_out','cancelled')`,
    ),
    check(
      "verification_duration_check",
      sql`${table.durationMs} is null or ${table.durationMs} >= 0`,
    ),
    foreignKey({
      name: "verification_org_incident_fk",
      columns: [table.organizationId, table.incidentId],
      foreignColumns: [incidents.organizationId, incidents.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "verification_org_project_scenario_fk",
      columns: [table.organizationId, table.projectId, table.scenarioId],
      foreignColumns: [
        testScenarios.organizationId,
        testScenarios.projectId,
        testScenarios.id,
      ],
    }).onDelete("restrict"),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 100 }).notNull(),
    resourceType: varchar("resource_type", { length: 80 }).notNull(),
    resourceId: varchar("resource_id", { length: 100 }),
    requestId: varchar("request_id", { length: 100 }),
    outcome: varchar("outcome", { length: 20 }).notNull().default("success"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_org_time_idx").on(table.organizationId, table.createdAt),
    index("audit_resource_idx").on(
      table.organizationId,
      table.resourceType,
      table.resourceId,
      table.createdAt,
    ),
    check(
      "audit_outcome_check",
      sql`${table.outcome} in ('success','denied','failure')`,
    ),
  ],
);

export const outbox = pgTable(
  "outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    topic: varchar("topic", { length: 80 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    deliveredAt: timestamp("delivered_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastErrorCode: varchar("last_error_code", { length: 80 }),
    createdAt: createdAt(),
  },
  (table) => [
    index("outbox_pending_idx").on(table.status, table.availableAt),
    check(
      "outbox_status_check",
      sql`${table.status} in ('pending','processing','delivered','failed')`,
    ),
    check("outbox_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

// ForceRowLevelSecurity is also enabled in the SQL migration. The application sets both
// settings with SET LOCAL inside a transaction before querying these tables.
