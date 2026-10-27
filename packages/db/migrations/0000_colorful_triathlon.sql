CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"key_prefix" varchar(20) NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] DEFAULT ARRAY['events:write']::text[] NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"actor_user_id" text,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(80) NOT NULL,
	"resource_id" varchar(100),
	"request_id" varchar(100),
	"outcome" varchar(20) DEFAULT 'success' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_outcome_check" CHECK ("audit_logs"."outcome" in ('success','denied','failure'))
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid NOT NULL,
	"version" varchar(120) NOT NULL,
	"commit_sha" varchar(100),
	"status" varchar(20) NOT NULL,
	"deployed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" varchar(40) DEFAULT 'manual' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "deployments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "deployments_status_check" CHECK ("deployments"."status" in ('started','succeeded','failed','rolled_back','unknown'))
);
--> statement-breakpoint
CREATE TABLE "environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "environments_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "environments_org_project_id_uq" UNIQUE("organization_id","project_id","id")
);
--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"investigation_id" uuid NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"source_ref" varchar(200) NOT NULL,
	"source_occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content" text NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "evidence_org_investigation_id_uq" UNIQUE("organization_id","investigation_id","id")
);
--> statement-breakpoint
CREATE TABLE "hypotheses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"investigation_id" uuid NOT NULL,
	"claim" varchar(500) NOT NULL,
	"rationale" varchar(2000) NOT NULL,
	"confidence" varchar(20) NOT NULL,
	"proposed_check" varchar(1000),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hypotheses_org_investigation_id_uq" UNIQUE("organization_id","investigation_id","id")
);
--> statement-breakpoint
CREATE TABLE "hypothesis_evidence" (
	"organization_id" uuid NOT NULL,
	"investigation_id" uuid NOT NULL,
	"hypothesis_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"relationship" varchar(20) NOT NULL,
	"explanation" varchar(1000),
	CONSTRAINT "hypothesis_evidence_hypothesis_id_evidence_id_relationship_pk" PRIMARY KEY("hypothesis_id","evidence_id","relationship"),
	CONSTRAINT "hypothesis_evidence_relation_check" CHECK ("hypothesis_evidence"."relationship" in ('supports','contradicts','context'))
);
--> statement-breakpoint
CREATE TABLE "incident_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"telemetry_event_id" uuid,
	"event_type" varchar(40) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid,
	"fingerprint" varchar(64) NOT NULL,
	"grouping_version" varchar(40) NOT NULL,
	"title" varchar(180) NOT NULL,
	"summary" text,
	"status" varchar(20) DEFAULT 'open' NOT NULL,
	"severity" varchar(20) DEFAULT 'warning' NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"event_count" integer DEFAULT 1 NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "incidents_status_check" CHECK ("incidents"."status" in ('open','investigating','monitoring','resolved','ignored')),
	CONSTRAINT "incidents_severity_check" CHECK ("incidents"."severity" in ('info','warning','error','critical')),
	CONSTRAINT "incidents_event_count_check" CHECK ("incidents"."event_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "investigations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"provider" varchar(40) NOT NULL,
	"model" varchar(100) NOT NULL,
	"prompt_version" varchar(40) NOT NULL,
	"summary" text,
	"result" jsonb,
	"error_code" varchar(80),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investigations_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "investigations_org_incident_id_uq" UNIQUE("organization_id","incident_id","id"),
	CONSTRAINT "investigations_status_check" CHECK ("investigations"."status" in ('queued','running','completed','failed','cancelled'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"organization_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" varchar(20) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id"),
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" in ('owner','admin','member','viewer'))
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"plan" varchar(20) DEFAULT 'free' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_id_uq" UNIQUE("id"),
	CONSTRAINT "organizations_plan_check" CHECK ("organizations"."plan" in ('free','team','internal'))
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"topic" varchar(80) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"last_error_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_status_check" CHECK ("outbox"."status" in ('pending','processing','delivered','failed')),
	CONSTRAINT "outbox_attempts_check" CHECK ("outbox"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"description" varchar(500),
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"service_key" varchar(100) NOT NULL,
	"description" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "services_org_project_id_uq" UNIQUE("organization_id","project_id","id")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"userId" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "telemetry_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"environment_id" uuid,
	"service_id" uuid,
	"event_type" varchar(20) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"trace_id" varchar(64),
	"span_id" varchar(32),
	"fingerprint" varchar(64),
	"grouping_version" varchar(40),
	"message" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"redaction_version" varchar(20) DEFAULT 'v1' NOT NULL,
	"idempotency_key" varchar(200),
	"content_hash" varchar(64),
	CONSTRAINT "events_org_id_uq" UNIQUE("organization_id","id"),
	CONSTRAINT "telemetry_event_type_check" CHECK ("telemetry_events"."event_type" in ('log','error','trace','metric','custom')),
	CONSTRAINT "telemetry_severity_check" CHECK ("telemetry_events"."severity" in ('debug','info','warning','error','critical','unknown'))
);
--> statement-breakpoint
CREATE TABLE "test_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"scenario_key" varchar(80) NOT NULL,
	"description" varchar(500) NOT NULL,
	"scenario_version" varchar(40) NOT NULL,
	"definition" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scenarios_org_project_id_uq" UNIQUE("organization_id","project_id","id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"commit_sha" varchar(100),
	"scenario_version" varchar(40) NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"summary" varchar(1000),
	"report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_code" varchar(80),
	"triggered_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_status_check" CHECK ("verification_runs"."status" in ('queued','running','passed','failed','error','timed_out','cancelled')),
	CONSTRAINT "verification_duration_check" CHECK ("verification_runs"."duration_ms" is null or "verification_runs"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_org_environment_fk" FOREIGN KEY ("organization_id","environment_id") REFERENCES "public"."environments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "environments" ADD CONSTRAINT "environments_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_org_investigation_fk" FOREIGN KEY ("organization_id","investigation_id") REFERENCES "public"."investigations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypotheses" ADD CONSTRAINT "hypotheses_org_investigation_fk" FOREIGN KEY ("organization_id","investigation_id") REFERENCES "public"."investigations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypothesis_evidence" ADD CONSTRAINT "hypothesis_evidence_investigation_fk" FOREIGN KEY ("organization_id","investigation_id","hypothesis_id") REFERENCES "public"."hypotheses"("organization_id","investigation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hypothesis_evidence" ADD CONSTRAINT "hypothesis_evidence_source_fk" FOREIGN KEY ("organization_id","investigation_id","evidence_id") REFERENCES "public"."evidence_items"("organization_id","investigation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_org_incident_fk" FOREIGN KEY ("organization_id","incident_id") REFERENCES "public"."incidents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_org_event_fk" FOREIGN KEY ("organization_id","telemetry_event_id") REFERENCES "public"."telemetry_events"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_org_environment_fk" FOREIGN KEY ("organization_id","environment_id") REFERENCES "public"."environments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_org_incident_fk" FOREIGN KEY ("organization_id","incident_id") REFERENCES "public"."incidents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "telemetry_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "events_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "events_org_environment_fk" FOREIGN KEY ("organization_id","environment_id") REFERENCES "public"."environments"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telemetry_events" ADD CONSTRAINT "events_org_service_fk" FOREIGN KEY ("organization_id","service_id") REFERENCES "public"."services"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_scenarios" ADD CONSTRAINT "test_scenarios_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_scenarios" ADD CONSTRAINT "scenarios_org_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_runs_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_org_incident_fk" FOREIGN KEY ("organization_id","incident_id") REFERENCES "public"."incidents"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_runs" ADD CONSTRAINT "verification_org_project_scenario_fk" FOREIGN KEY ("organization_id","project_id","scenario_id") REFERENCES "public"."test_scenarios"("organization_id","project_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_idx" ON "account" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_uq" ON "account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_uq" ON "api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_org_project_id_uq" ON "api_keys" USING btree ("organization_id","project_id","id");--> statement-breakpoint
CREATE INDEX "api_keys_project_active_idx" ON "api_keys" USING btree ("organization_id","project_id","created_at") WHERE "api_keys"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "audit_org_time_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_logs" USING btree ("organization_id","resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "deployments_environment_time_idx" ON "deployments" USING btree ("organization_id","environment_id","deployed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "environments_project_slug_uq" ON "environments" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "environments_project_idx" ON "environments" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "evidence_investigation_idx" ON "evidence_items" USING btree ("organization_id","investigation_id","created_at");--> statement-breakpoint
CREATE INDEX "incident_events_timeline_idx" ON "incident_events" USING btree ("organization_id","incident_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_events_event_uq" ON "incident_events" USING btree ("organization_id","telemetry_event_id") WHERE "incident_events"."telemetry_event_id" is not null;--> statement-breakpoint
CREATE INDEX "incidents_status_time_idx" ON "incidents" USING btree ("organization_id","project_id","status","last_seen_at");--> statement-breakpoint
CREATE INDEX "incidents_project_time_idx" ON "incidents" USING btree ("organization_id","project_id","first_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_open_fingerprint_uq" ON "incidents" USING btree ("organization_id","project_id","fingerprint",coalesce("environment_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "incidents"."status" in ('open','investigating','monitoring');--> statement-breakpoint
CREATE INDEX "investigations_incident_time_idx" ON "investigations" USING btree ("organization_id","incident_id","created_at");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug_uq" ON "projects" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "projects_org_created_idx" ON "projects" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "services_project_key_uq" ON "services" USING btree ("project_id","service_key");--> statement-breakpoint
CREATE INDEX "services_project_idx" ON "services" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "session" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "events_idempotency_uq" ON "telemetry_events" USING btree ("organization_id","project_id","idempotency_key") WHERE "telemetry_events"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "events_project_time_idx" ON "telemetry_events" USING btree ("organization_id","project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_fingerprint_time_idx" ON "telemetry_events" USING btree ("organization_id","project_id","fingerprint","environment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "events_trace_idx" ON "telemetry_events" USING btree ("organization_id","trace_id") WHERE "telemetry_events"."trace_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "scenarios_project_key_uq" ON "test_scenarios" USING btree ("project_id","scenario_key");--> statement-breakpoint
CREATE INDEX "verification_incident_time_idx" ON "verification_runs" USING btree ("organization_id","incident_id","created_at");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");
-- Tenant policies apply to a non-owner runtime role. app.organization_id is set
-- transaction-locally by the API/worker after authorization and parent validation.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'projects','environments','services','deployments','telemetry_events','incidents',
    'incident_events','investigations','evidence_items','hypotheses','hypothesis_evidence',
    'test_scenarios','verification_runs','audit_logs'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid) WITH CHECK (organization_id = nullif(current_setting(''app.organization_id'', true), '''')::uuid)',
      table_name || '_tenant_policy', table_name
    );
  END LOOP;
END $$;

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY api_keys_tenant_policy ON api_keys
  USING (
    organization_id = nullif(current_setting('app.organization_id', true), '')::uuid
    OR current_setting('app.key_lookup', true) = 'on'
  )
  WITH CHECK (organization_id = nullif(current_setting('app.organization_id', true), '')::uuid);
