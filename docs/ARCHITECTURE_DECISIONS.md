# Architecture decisions

## ADR 001: Modular monorepo with a separate worker

**Status:** Accepted. SignalForge uses a Next.js web app, Fastify API, PostgreSQL, and a separate persistent worker. Product contracts and domain rules live in shared packages. PostgreSQL remains authoritative while the outbox enables asynchronous recovery.

## ADR 002: Better Auth for identity

**Status:** Accepted. Better Auth provides maintained email/password and database-backed sessions. The API rechecks session identity and current organization membership on protected operations. Email verification and password recovery delivery are not configured because no mail provider is available.

## ADR 003: PostgreSQL outbox with optional Redis delivery

**Status:** Accepted. Redis/BullMQ is an optional delivery transport; PostgreSQL remains the durable source. An outbox row stays `processing` after enqueue and is acknowledged only after the BullMQ processor succeeds. Queue dispatch failures return the row to `pending` with capped exponential backoff without consuming processor retries. The worker reconciles stale leases against BullMQ state, requeues missing jobs, and marks completed or exhausted jobs terminal. In fallback mode it polls PostgreSQL directly and heartbeats active work. PostgreSQL recovery helpers, Redis-backed workflow, poison-job exhaustion, and delivery after a Redis restart have been exercised locally; broader production outage behavior remains unverified.

## ADR 004: Organization tenant isolation

**Status:** Accepted and partially integration-tested. Tenant data uses organization-scoped queries, composite constraints, transaction-local tenant context, and forced PostgreSQL RLS. The restricted non-owner `signalforge_app` tests verify cross-organization project reads, event-correlation scoping, key lookup/scope checks, and cross-project ingestion rejection. A full route-by-route two-organization access matrix remains outstanding.

## ADR 005: Registered verification only

**Status:** Accepted. Verification requests name one of the registered scenario keys. The API does not accept arbitrary commands or executable paths. The runner reports assertion results and is deployed separately. Local Compose gives the runner a read-only filesystem, bounded temporary storage, dropped capabilities, resource limits, and an internal network shared with only its worker and sample service; equivalent production controls and independent review remain required.

## ADR 006: Provider abstraction and evidence validation

**Status:** Accepted. A deterministic mock provider supports reproducible development; the optional OpenAI adapter requests structured output. Shared Zod validation checks the output, the server verifies every evidence reference against evidence persisted for that investigation before saving hypotheses, and available provider token counts are stored on the investigation. The live provider has not been exercised here.

## ADR 007: Scope of the browser MVP

**Status:** Accepted for the current delivery slice. The UI supports authentication, onboarding, incident review, investigations, verification, API keys, organization access, project environments/services/deployments, and audit review. Retention is a global environment setting; per-organization retention controls remain outstanding.

## ADR 008: Dependency security updates

**Status:** Accepted. A production dependency audit led to compatible upgrades for Zod, Drizzle ORM, Vitest, Better Auth, and OpenTelemetry. Pnpm overrides pin patched versions of transitive esbuild, PostCSS, protobufjs, and Jaeger propagation packages. `pnpm audit --prod` reports zero advisories, and the fresh migration, type, build, unit, integration, smoke, and browser checks pass on the updated set.

## ADR 009: Verification checks the running sample service

**Status:** Accepted. The verification runner sends only registered scenario keys to an authenticated internal endpoint on the sample checkout service. The recovery scenario is passed only when the service executes `SELECT 1` against a dedicated `DEMO_DATABASE_URL` and returns the expected structured result. The demo database is separate from tenant data. This verifies the sample environment only; it does not execute customer code or prove a production repair. Local Compose resource, filesystem, capability, and network restrictions were verified; production deployment controls remain unverified.

## ADR 010: Public overview and authenticated workspace routes

**Status:** Accepted. `/` presents the public product overview and `/app` serves the existing authenticated workspace. The overview links into registration/sign-in and explains the evidence, mock AI, and verification boundaries without showing synthetic operational metrics.

## ADR 011: PostgreSQL-backed job recovery

**Status:** Accepted. Outbox leases are periodically reconciled, not reset only at process startup. The PostgreSQL-only worker heartbeats active jobs and can resume a domain record left in `running` after a process crash. When Redis is configured, a stale outbox lease is checked against BullMQ: completed jobs are acknowledged, failed jobs become terminal, queued or active jobs retain the lease, and missing jobs are returned to PostgreSQL pending state. The PostgreSQL fallback and state reconciliation are integration-tested. Redis/BullMQ job execution, retry exhaustion, and delivery following a Redis restart have also passed in an isolated local Compose run.
