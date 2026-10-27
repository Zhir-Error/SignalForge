# SignalForge: Complete Product, Architecture, and Engineering Plan

> **Working title:** SignalForge  
> **Product category:** Developer reliability SaaS / AI-assisted incident investigation  
> **Target build window:** 8–12 weeks  
> **Primary stack:** Next.js, TypeScript, Node.js, PostgreSQL  
> **Document status:** Product and engineering proposal, not a claim that the product has already been implemented  
> **Last reviewed:** October 26, 2026

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision and Positioning](#2-product-vision-and-positioning)
3. [Problem Statement and User Research](#3-problem-statement-and-user-research)
4. [Target Users and Jobs to Be Done](#4-target-users-and-jobs-to-be-done)
5. [Competitive Landscape](#5-competitive-landscape)
6. [Differentiation and Product Principles](#6-differentiation-and-product-principles)
7. [Goals and Success Metrics](#7-goals-and-success-metrics)
8. [Scope and Requirements](#8-scope-and-requirements)
9. [Core User Journeys](#9-core-user-journeys)
10. [System Architecture](#10-system-architecture)
11. [Technology Choices](#11-technology-choices)
12. [Repository Structure](#12-repository-structure)
13. [Domain Model and Database Schema](#13-domain-model-and-database-schema)
14. [Data Retention, Indexing, and Query Strategy](#14-data-retention-indexing-and-query-strategy)
15. [API Architecture and Endpoint Specifications](#15-api-architecture-and-endpoint-specifications)
16. [Event Ingestion and Correlation Engine](#16-event-ingestion-and-correlation-engine)
17. [AI Investigation Pipeline](#17-ai-investigation-pipeline)
18. [Verification Engine and Safe Execution](#18-verification-engine-and-safe-execution)
19. [Frontend Information Architecture](#19-frontend-information-architecture)
20. [UI/UX Design System](#20-uiux-design-system)
21. [Authentication, Authorization, and Tenant Isolation](#21-authentication-authorization-and-tenant-isolation)
22. [Security and Threat Model](#22-security-and-threat-model)
23. [Privacy and Data Governance](#23-privacy-and-data-governance)
24. [Reliability and Background Jobs](#24-reliability-and-background-jobs)
25. [Testing and Quality Strategy](#25-testing-and-quality-strategy)
26. [AI Evaluation Plan](#26-ai-evaluation-plan)
27. [Observability for SignalForge Itself](#27-observability-for-signalforge-itself)
28. [Deployment and Infrastructure](#28-deployment-and-infrastructure)
29. [Environment Configuration](#29-environment-configuration)
30. [Development Workflow and Coding Standards](#30-development-workflow-and-coding-standards)
31. [Eight- to Twelve-Week Roadmap](#31-eight--to-twelve-week-roadmap)
32. [MVP Acceptance Criteria](#32-mvp-acceptance-criteria)
33. [Release Checklist](#33-release-checklist)
34. [Portfolio and Case-Study Strategy](#34-portfolio-and-case-study-strategy)
35. [Startup Validation and Commercial Direction](#35-startup-validation-and-commercial-direction)
36. [Risks and Trade-Offs](#36-risks-and-trade-offs)
37. [Implementation Prompts for an AI Coding Assistant](#37-implementation-prompts-for-an-ai-coding-assistant)
38. [Recommended Build Order](#38-recommended-build-order)
39. [Glossary](#39-glossary)
40. [References and Further Reading](#40-references-and-further-reading)

---

# 1. Executive Summary

## 1.1 The idea

**SignalForge is a reliability laboratory for developers.** It helps small software teams reproduce an application failure, correlate relevant telemetry and deployment history, inspect an AI-generated diagnosis with evidence citations, and verify whether a proposed fix actually resolves the failure.

The product is intentionally narrower than an enterprise observability suite. It does not collect every metric from every service or automatically remediate production systems. Its core workflow is:

**Reproduce → Correlate → Explain → Verify → Learn**

A developer starts with a seeded sample application. The application generates an error after a simulated deployment. SignalForge records the related events, groups them into an incident, connects the incident to relevant deployment and trace data, and assembles a bounded evidence package. An AI provider returns one or more root-cause hypotheses in a strict schema. The server validates every evidence reference before displaying the result. The developer then changes the sample code or configuration and runs a controlled verification scenario. The platform records the actual test outcome instead of allowing the model to declare success on its own.

## 1.2 Why this is a strong portfolio project

SignalForge demonstrates more engineering depth than a standard CRUD dashboard:

- Full-stack product development with a meaningful domain model.
- TypeScript across frontend, API, worker, validation, and shared contracts.
- PostgreSQL schema design, migrations, constraints, indexes, and tenant isolation.
- Authentication, authorization, scoped API keys, and audit logs.
- Event ingestion, idempotency, deduplication, background jobs, retries, and live updates.
- Logs, traces, deployment events, and deterministic correlation rules.
- AI integration with structured output, evidence grounding, validation, evaluation, and cost controls.
- Safe test execution, deterministic acceptance criteria, and before/after verification.
- Docker-based local development, CI/CD, deployment, operational monitoring, and documentation.

The point is to demonstrate engineering judgment rather than technology collecting. A compact, reliable product is more impressive than an unfinished system that claims to support every cloud platform, programming language, and monitoring vendor.

## 1.3 Positioning statement

> For independent developers and small SaaS teams that struggle to understand deployment-related failures, SignalForge connects telemetry and deployments into evidence-backed investigations and lets developers verify fixes through controlled, reproducible scenarios.

**Tagline:** “Investigate the failure. Prove the fix.”

**Short description:** SignalForge connects application errors, logs, traces, and deployment history, then helps developers investigate plausible causes and check whether a fix works.

## 1.4 Scope commitment

The MVP focuses on Node.js services, PostgreSQL-backed examples, a seeded demo environment, one AI provider adapter, and deterministic test scenarios. External integrations such as GitHub and direct OpenTelemetry ingestion come after the main workflow works end to end.

The 8–12 week target is a portfolio-quality MVP, not an enterprise-ready replacement for commercial observability vendors. Any production-readiness claims must be supported by testing, documentation, and measured results.

---

# 2. Product Vision and Positioning

## 2.1 Vision

Make incident investigation understandable, reproducible, evidence-based, and verifiable for small engineering teams.

## 2.2 Mission

Reduce the work required to move from an application error to a well-supported diagnosis and a tested resolution, while keeping developers in control of changes that could affect running systems.

## 2.3 Product thesis

Existing engineering tools can collect large quantities of telemetry, but an engineer still needs to decide which evidence is relevant, whether it supports a hypothesis, and whether the fix actually resolved the failure. AI can help summarize and reason over evidence, but an AI-generated explanation is not verified simply because it sounds fluent.

SignalForge separates five kinds of statements:

1. **Observation:** What the system actually recorded.
2. **Correlation:** Which observations are related by time, trace, service, deployment, or fingerprint.
3. **Hypothesis:** A possible explanation of the observations.
4. **Verification:** The result of executing a defined test in a controlled environment.
5. **Conclusion:** What the evidence and test results support, including unresolved uncertainty.

This separation must be reflected in the database, API, user interface, and AI prompts.

## 2.4 Product principles

### Evidence before explanation
Gather and persist relevant evidence before asking the AI to make a diagnosis. Never let the model invent telemetry identifiers or replace source records with its own narrative.

### Verification before victory claims
A fix is not marked verified because an AI response says it looks correct. It is verified only when a named verification run has completed and its status is derived from actual results.

### Secure by default
Every user-facing resource belongs to an organization or a tightly scoped parent resource. Tenant boundaries apply to HTTP routes, background jobs, database access, exports, and streams.

### Small and understandable first
Start with a modular application, database, queue, and worker. Do not introduce microservices, Kubernetes, or complex event streaming without a concrete need.

### Transparent about limitations
A hypothesis may be wrong, a correlation may be coincidental, and a test may cover only one scenario. The UI and documentation must make these limitations clear.

---

# 3. Problem Statement and User Research

## 3.1 Problem statement

When a developer sees an elevated error rate after a deployment, they may need to inspect an error tracker, application logs, distributed traces, commit history, configuration changes, monitoring charts, and test results. These sources may use different interfaces or identifiers. The developer must manually connect them and determine whether the issue is related to the latest deployment, a dependency, configuration drift, database behavior, or an unrelated event.

The problem is not only finding an explanation. The developer must also establish whether the explanation is supported and whether the proposed fix prevents the failure from recurring.

## 3.2 Assumptions to validate

Treat these as hypotheses, not established market facts:

- Small teams often investigate incidents without a dedicated reliability engineer.
- Deployment metadata and telemetry may be reviewed separately.
- Developers want AI assistance but do not want unsupported assertions or opaque remediation.
- A reproducible demo and test-backed report can create value without replacing existing monitoring systems.
- A small team may prefer a focused workflow over a broad platform with a large setup burden.

## 3.3 Discovery questions

Interview five to ten developers, startup engineers, or freelancers before investing heavily in optional integrations. Ask:

1. Tell me about the last difficult production or staging failure you investigated.
2. What did you inspect first, and which tools did you use?
3. How did you connect the failure to a deployment or code change?
4. What took the longest?
5. What evidence would you need before trusting an AI-generated diagnosis?
6. How do you verify that a proposed fix solved the issue?
7. Which telemetry would you be comfortable sending to a third-party product?
8. What would prevent your team from trying this product?
9. Which existing tools must remain the source of truth?
10. Would you test it on a non-critical service or synthetic scenario?

Avoid leading questions like “Would you use this amazing AI tool?” Ask about recent behavior and concrete workflows instead.

## 3.4 Discovery evidence

Record anonymized notes, recurring pain points, current workarounds, tool names, security objections, and criteria for trying the product. Do not collect sensitive production logs, secrets, or proprietary code during discovery without a formal and safe handling process.

Before expanding beyond the demo workflow, aim for three independent people who recognize the pain from recent experience, two people willing to evaluate a working demo, and one realistic failure scenario approved by a developer using synthetic or sanitized data. These are practical project gates, not statistically valid market proof.

---

# 4. Target Users and Jobs to Be Done

## 4.1 Independent developer

**Context:** Maintains one or more web applications and handles deployment and bug fixing personally.

**Job to be done:** “When my application starts failing, help me connect the error to relevant events and verify the fix without forcing me to configure a large monitoring platform.”

**Needs:** Fast setup, reproducible demos, accessible evidence, concise reports, exportable results, and low operating cost.

## 4.2 Small SaaS engineering lead

**Context:** Coordinates a small team with limited reliability engineering capacity.

**Job to be done:** “When a service becomes unhealthy, give my team a shared incident record containing the important evidence, current hypotheses, and verification status.”

**Needs:** Organization and project boundaries, roles, audit logs, investigation history, shared reports, and reliable state transitions.

## 4.3 Freelancer or consultant

**Context:** Fixes bugs for client applications and must communicate what failed and how the correction was tested.

**Job to be done:** “Help me explain the evidence, the change, and the test results in a report that a client can understand.”

**Needs:** Before/after reports, reproducible scenarios, customer-friendly exports, and reliable records.

## 4.4 Educator or technical mentor

**Context:** Teaches debugging, observability, or incident response.

**Job to be done:** “Give learners a controlled failure scenario that demonstrates how to move from raw events to an evidence-based diagnosis and a tested fix.”

**Needs:** Resettable scenarios, predictable outcomes, explanatory timelines, and isolated demo accounts.

## 4.5 Initial role model

- **Owner:** All organization capabilities, including ownership-sensitive settings and deletion.
- **Admin:** Members, projects, keys, integrations, and normal organization settings; ownership transfer is separately controlled.
- **Member:** View and investigate authorized projects and start permitted verification scenarios.
- **Viewer:** Read-only access to explicitly shared project and incident data.

Do not rely on frontend-only role checks. The backend must enforce permissions.

---

# 5. Competitive Landscape

Competitive analysis is a snapshot, not a guarantee that product features or pricing remain unchanged. Recheck official documentation before a public launch and before making direct comparison claims.

## 5.1 Sentry

Sentry provides error monitoring and an AI debugging capability called Seer. Its documentation describes use of issue details, tracing data, logs, profiles, and code context to help troubleshoot errors and performance issues.

Official source: <https://docs.sentry.io/product/ai-in-sentry/seer/>

**Implication:** AI-assisted debugging is already an established product direction. Do not claim an AI root-cause assistant is unique on its own.

**Possible distinction:** Make reproducible scenarios, explicit evidence links, and post-fix verification the core workflow. Ingest selected events rather than attempting to rebuild Sentry's entire monitoring ecosystem.

## 5.2 Datadog

Datadog provides broad observability tooling and AI capabilities for investigations and operational workflows.

Official entry points: <https://www.datadoghq.com/> and <https://docs.datadoghq.com/>

**Implication:** A small product should not compete on telemetry volume, ecosystem breadth, enterprise integrations, or infrastructure scale.

**Possible distinction:** A narrow, transparent workflow that a developer can understand and reproduce quickly.

## 5.3 incident.io

incident.io focuses on incident management and incident-response workflows.

Official website: <https://incident.io/>

**Implication:** Incident coordination and AI support within incident workflows are not new categories.

**Possible distinction:** Focus on the technical chain from evidence correlation to a controlled verification result, rather than making responder coordination the primary value proposition.

## 5.4 OpenTelemetry

OpenTelemetry is a vendor-neutral framework for instrumenting, generating, collecting, and exporting telemetry, including traces, metrics, and logs. It is an interoperability layer, not a complete incident-investigation product.

Official documentation: <https://opentelemetry.io/docs/>

**Implication:** Reuse established standards instead of inventing an unnecessary proprietary telemetry format.

## 5.5 Directional comparison

| Capability | Error-monitoring product | Broad observability platform | Incident-management product | SignalForge MVP |
|---|---|---|---|---|
| Error events | Core capability | Supported | Usually integrated into wider workflows | Required for demo and ingestion API |
| Logs and traces | Often integrated | Broad support | Commonly integrated from other systems | Focused support for sample app and selected events |
| Deployment correlation | May be available | Broad ecosystem capability | Depends on configuration/integrations | Central workflow |
| AI investigation | Available in some products | Available in some products | Available in some workflows | Bounded evidence-based pipeline |
| Reproducible scenarios | Varies | Not the sole focus | Not the sole focus | Primary demo feature |
| Fix verification | Varies | May integrate with test/CI systems | Not generally the central technical loop | Explicit first-class workflow |
| Enterprise breadth | Mature ecosystems | Very broad | Focused on response workflows | Intentionally narrow |

This is a directional comparison, not a complete feature audit. Do not publish it as a definitive competitive matrix without further verification.

## 5.6 Competitive strategy

Do not promise SignalForge is “the first” AI incident investigator or “the only” product that verifies fixes. Use a precise promise:

> SignalForge provides a focused, reproducible workflow for connecting an application failure to evidence, reviewing an AI-generated hypothesis, and recording a controlled verification result.

The strength of the product will come from implementation quality, usable evidence, clear failure handling, and a convincing live demo—not unsupported novelty claims.

---

# 6. Differentiation and Product Principles

## 6.1 Differentiation hypothesis

The proposed differentiator is the **verification loop**:

1. Create or detect a failure.
2. Gather relevant events and deployment context.
3. Produce a hypothesis linked to evidence.
4. Allow a developer to review it.
5. Run a controlled test.
6. Record the result and identify remaining uncertainty.

Existing tools may offer overlapping features. SignalForge should distinguish itself through the quality and clarity of this workflow, not by asserting that no competitor can do any part of it.

## 6.2 Trust model

- **Observed:** Directly supported by a persisted event, trace, deployment record, or test output.
- **Correlated:** Connected to other observations by a defined rule or relation.
- **Hypothesized:** An explanation proposed by a model or rule engine.
- **Verified:** A result established by execution of a named test scenario with a recorded result.
- **Unknown:** Relevant data has not been collected or no justified conclusion is available.

## 6.3 Product rules

- Never display invented evidence identifiers as real citations.
- Never allow the model to directly resolve an incident.
- Never treat timing alone as proof of causation.
- Never run arbitrary customer code in the API process or an unrestricted worker.
- Never trust organization or project IDs without server-side authorization.
- Never show a “verified” badge without a completed verification run.
- Always allow users to inspect the source evidence behind a summary.
- Always provide a demo path that works without paid third-party AI credentials.

---

# 7. Goals and Success Metrics

## 7.1 Product goals

1. Make a seeded failure reproducible.
2. Link events to an incident through deterministic rules.
3. Present relevant evidence in an understandable timeline.
4. Produce structured AI hypotheses with validated evidence references.
5. Run a safe, predefined verification scenario.
6. Support multiple organizations with tested tenant isolation.
7. Make the critical workflow accessible through a public demo.
8. Document the system well enough that another developer can run it locally.

## 7.2 Non-goals

The MVP will not replace Sentry, Datadog, or a full observability stack; automatically change or deploy production code; execute arbitrary customer shell commands; provide a production SLA; support every language or infrastructure provider; build a foundation model; guarantee AI diagnosis accuracy; or claim market uniqueness without research.

## 7.3 Product metrics

| Metric | Definition | Measurement approach |
|---|---|---|
| Demo completion rate | Sessions finishing the core workflow / sessions that start it | Instrument the seeded journey |
| Time to first incident | Time from demo setup to the first visible incident | Measure in the deterministic demo |
| Evidence link validity | Accepted references resolving to persisted evidence | Target 100% for accepted output |
| Verification integrity | Verification status matching stored test result | Target 100% for deterministic tests |
| Duplicate handling | Duplicate events after idempotent retries | No duplicates within the documented key window |
| Tenant isolation | Unauthorized cross-tenant reads/writes that succeed | Zero in the security test suite |
| Job recovery | Jobs reaching completion or a visible terminal state | Measure and report |
| AI cost per investigation | Actual provider cost where available | Record per run where supported |
| Unsupported claims | Unsupported statements in evaluated output | Establish baseline and reduce |
| Onboarding completion | Users creating a project and running the demo | Establish a baseline |

## 7.4 Engineering success criteria

- Strict TypeScript compilation.
- Reproducible Docker Compose setup.
- Versioned migrations validated in CI.
- Unit, integration, and end-to-end tests.
- Explicit authorization tests for tenant-scoped resources.
- Structured logs and metrics for API and worker.
- Health endpoints and operational documentation.
- Documented data retention.
- Public demo with synthetic data and safe defaults.

---

# 8. Scope and Requirements

## 8.1 Functional requirements

### FR-01: Identity and sessions
Users can sign in, sign out, recover access through the chosen identity provider, and view their profile. Use secure server-side session handling. Avoid storing long-lived bearer tokens in browser local storage.

### FR-02: Organizations
An authenticated user can create an organization, list organizations they belong to, and switch active organization context. Every switch is validated against membership records.

### FR-03: Membership and roles
Owners and authorized admins can invite members, update permitted roles, revoke membership, and inspect current membership. The system must prevent accidental removal of the last owner.

### FR-04: Projects and environments
Members with sufficient permissions can create projects and environments, define services, and view project summaries. Slugs are unique within the relevant scope.

### FR-05: Deployment records
Authorized users or integrations can record a deployment with commit identifier, version, environment, timestamp, status, and safe metadata.

### FR-06: API keys
An authorized project member can create a scoped ingestion key. Plaintext key material is shown only once; a cryptographic hash is stored. Keys can be named, rotated, revoked, and optionally expired.

### FR-07: Telemetry ingestion
Authenticated sources can submit validated events. The server enforces payload size, schema, timestamp bounds, scope, rate limits, and redaction. Retries with the same idempotency key follow documented behavior.

### FR-08: Incident grouping
The event pipeline groups events using deterministic fingerprints and windows. Incidents have a controlled lifecycle, severity, timestamps, and project/environment association.

### FR-09: Investigation jobs
An authorized member can enqueue an investigation. The API returns an investigation identifier; the browser can track status and retrieve the result.

### FR-10: Evidence management
Every investigation stores the bounded evidence used to generate its result. Evidence has source type, source reference, capture time, content hash where useful, and sanitized content or extracted fields.

### FR-11: AI result validation
The adapter returns structured output. The server validates schema, evidence references, allowed fields, and content length before persisting a result.

### FR-12: Verification scenarios
An authorized user can run a predefined scenario in an isolated environment. The system records scenario version, commit/build identifier where available, timestamps, result, and execution limits.

### FR-13: Audit trail
Security- and administration-relevant actions record actor, organization, action, resource, timestamp, and request ID. Secrets and sensitive payloads must not enter audit metadata.

### FR-14: Live updates
The UI can receive authorized updates for incident creation, investigation status, and verification status. Live events contain minimal metadata; clients fetch authoritative records through authorized APIs.

### FR-15: Seeded demo
The app provides a resettable scenario that reliably generates an incident and a second scenario that represents recovery. Data is synthetic and does not require access to real infrastructure.

## 8.2 Non-functional requirements

- **Security:** server-side authorization, tenant scoping, secure sessions, scoped keys, rate limiting, safe validation, restricted execution.
- **Reliability:** slow model calls do not block ordinary API requests; jobs have bounded retries and terminal states.
- **Performance:** bounded pagination and indexed queries; targets measured in documented environments.
- **Accessibility:** keyboard support, visible focus, semantic controls, readable contrast, responsive layout.
- **Maintainability:** domain packages with clear ownership and shared runtime contracts.
- **Portability:** documented commands, versions, environment variables, and local services.
- **Observability:** structured logs, request/job IDs, health checks, and secret-safe diagnostics.

---

# 9. Core User Journeys

## 9.1 First-time onboarding

1. User opens the landing page.
2. User launches the demo or registers.
3. User creates an organization or accepts an invitation.
4. User creates a project.
5. User selects the seeded sample application.
6. The UI explains how telemetry is generated.
7. User starts the failure scenario.
8. An incident appears in the incident explorer.
9. User opens the incident workspace.
10. User runs an investigation or views a labelled precomputed result if no provider is configured.
11. User inspects citations and limitations.
12. User runs a predefined verification scenario.
13. User reads the report.

**Success condition:** The user reaches the report without needing a real production integration.

## 9.2 Investigating an incident

1. Open an incident.
2. Load its timeline, summary, deployments, related telemetry, and previous investigations.
3. Inspect timestamps and correlation rules.
4. Start an investigation.
5. Display queued/running/completed/failed states.
6. Show hypotheses, supporting and contradictory evidence, and limitations.
7. Let the user open each cited source record.
8. Select a permitted verification scenario.
9. Run it within configured limits.
10. Display the actual result and link to the scenario output.

## 9.3 Managing access

1. Owner opens organization settings.
2. Owner reviews memberships and roles.
3. Owner invites a member or changes a role.
4. Server validates the actor's role and organization.
5. Server records an audit event.
6. UI displays the updated membership.
7. Tests verify a removed/downgraded user cannot access protected resources.

## 9.4 Rotating an API key

1. Authorized user opens project key settings.
2. User creates a replacement key.
3. Server generates high-entropy material, stores a hash and metadata, and shows plaintext once.
4. User updates the sample service.
5. User tests ingestion with the replacement key.
6. User revokes the old key.
7. Server rejects the old key and records an audit event.

## 9.5 Recovering from worker failure

1. Worker claims a queued job.
2. A transient error occurs.
3. Retry policy schedules another attempt with backoff.
4. If it succeeds, the job completes.
5. If attempts are exhausted, the job reaches a visible failed state with a sanitized error code.
6. The UI offers a safe retry if appropriate.
7. Logs retain request/job correlation IDs without sensitive prompts or secrets.

---

# 10. System Architecture

## 10.1 High-level architecture

```mermaid
flowchart TD
    Person[Developer / Team] --> Web[Next.js Web App]
    Web --> BFF[Next.js Server Actions / BFF]
    BFF --> API[Fastify TypeScript API]
    API --> DB[(PostgreSQL)]
    API --> Redis[(Redis)]
    API --> Queue[Background Queues]
    Demo[Instrumented Node.js Sample App] --> Ingest[Telemetry Ingestion API]
    OTel[OpenTelemetry Collector - Later Phase] --> Ingest
    Ingest --> DB
    Queue --> Worker[Background Worker]
    Worker --> DB
    Worker --> Correlator[Deterministic Correlation Engine]
    Correlator --> Evidence[Persisted Evidence Package]
    Evidence --> AI[AI Provider Adapter]
    AI --> Validator[Schema and Citation Validator]
    Validator --> DB
    Worker --> Runner[Restricted Verification Runner]
    Runner --> DB
    API --> Stream[SSE Updates]
    Stream --> Web
```

## 10.2 Component responsibilities

### Next.js web app
Owns page routing, UI composition, accessible components, server-rendered reads where useful, form state, and user interactions. It should not contain the incident engine or expose database credentials to the browser.

### Backend-for-frontend (BFF)
The BFF validates the user session, derives actor and organization context server-side, and provides a safe same-origin interface. If it passes a signed identity assertion to the API, the API verifies issuer, audience, expiry, and signature. Internal signing secrets must never enter client bundles. An alternative is a shared identity provider issuing API access tokens. Choose one strategy and document it; never trust user IDs supplied only in browser headers.

### Fastify API
Owns API contracts, validation, authorization, business operations, ingestion, pagination, idempotency, and queue submission. Keep HTTP handlers thin; put business rules in testable services.

### PostgreSQL
Owns durable application state and authoritative results: identity mapping, organizations, memberships, projects, telemetry, incidents, investigations, evidence, hypotheses, verification runs, keys, integrations, and audits.

### Redis and queue
Redis backs background jobs and selected short-lived coordination. Durable business state stays in PostgreSQL. Queue payloads should contain resource identifiers and minimal parameters rather than full raw telemetry where possible.

### Background worker
Performs event correlation, evidence assembly, model calls, validation, reports, and job-state transitions. Workers must re-read authoritative entities and apply tenant scoping exactly as the API does.

### Sample application
A small Node.js service with deterministic failure modes, basic instrumentation, and reset logic. It is the main demo and test fixture.

### Verification runner
Runs registered scenario types in an isolated environment. It has no unrestricted shell endpoint and accepts no arbitrary user-supplied command.

## 10.3 Architecture style

Use a **modular monolith plus worker**. Separate deployable processes are reasonable for web rendering, API/ingestion, background jobs, and the restricted runner/sample app. Do not make each domain package a network service in the MVP; every additional service adds networking, deployment, logging, configuration, and security work.

## 10.4 Human request flow

1. Browser sends a same-origin request with its secure session cookie.
2. BFF validates the session.
3. BFF resolves the selected organization from server-side state.
4. API receives validated user identity using the documented strategy.
5. API verifies membership and resource ownership from the database.
6. Domain service executes the operation.
7. Required audit records are written.
8. Response returns with request ID and safe error shape.

## 10.5 Telemetry request flow

1. Source sends an event with a scoped project key.
2. API verifies key identity, active status, scope, expiry, and revocation.
3. API validates schema and bounds.
4. API validates the idempotency key.
5. API redacts/sanitizes allowed fields and stores the event.
6. A queue job is created or a transactional outbox record is persisted.
7. Worker correlates new events and updates incident state.
8. Authorized clients receive minimal updates and fetch full records through authorized endpoints.

## 10.6 Investigation request flow

1. Client requests an investigation for an authorized incident.
2. API validates permissions, state, rate limits, and idempotency.
3. API creates an investigation record and job.
4. Worker queries bounded, relevant persisted evidence.
5. Worker stores the evidence package and content hashes.
6. Worker sends only permitted evidence to the provider.
7. Adapter parses and validates output.
8. Citation validator verifies every evidence reference.
9. Accepted output is persisted.
10. Investigation becomes completed or enters a clear failure state.
11. UI retrieves the authoritative record.

---

# 11. Technology Choices

## 11.1 Frontend

- **Next.js App Router:** page routing, layouts, server rendering where useful, and a clear public/app split.
- **React + TypeScript:** reusable, typed components.
- **Tailwind CSS:** consistent design implementation.
- **shadcn/ui or another accessible component foundation:** forms, dialogs, menus, tables, and layout primitives.
- **Recharts or another chart library:** time series and summary charts.
- **React Hook Form + Zod:** form state and runtime validation where useful.

Avoid excessive gradients, animated backgrounds, decorative cards, and synthetic metrics that distract from the core product workflow.

## 11.2 Backend

- **Node.js + TypeScript:** common language across frontend and backend.
- **Fastify:** modular HTTP server with schema-oriented validation and plugin encapsulation.
- **Zod:** runtime contracts shared across packages where practical.
- **OpenAPI:** generated or maintained API documentation.
- **Drizzle ORM:** typed SQL access and migrations while keeping SQL visible for critical queries.

Official references: <https://fastify.dev/docs/latest/>, <https://orm.drizzle.team/docs/overview>, <https://zod.dev/>.

## 11.3 Identity strategy

Choose one supported strategy:

**Pattern A — Next.js BFF:** Validate the session in Next.js and pass a short-lived signed identity assertion to the API. The API verifies issuer, audience, expiry, and signature, then checks current membership in the database.

**Pattern B — Shared identity provider:** Use a provider that issues API access tokens and validate them in both layers. The API still checks current membership and permissions.

Do not pass user IDs as trusted headers from the browser, put internal signing keys in `NEXT_PUBLIC_*`, or rely on frontend roles as authorization.

## 11.4 Database

Use PostgreSQL as the durable store. Use migrations, explicit constraints, transactions, and indexes. Keep tenant ownership visible in data access code. Do not accept arbitrary SQL or raw table names from users.

## 11.5 Queue

Use Redis + BullMQ for investigation and correlation jobs. Jobs need stable identifiers where idempotency matters, bounded retries, backoff for transient errors, processing deadlines, sanitized failure metadata, concurrency limits, and terminal states.

Official references: <https://docs.bullmq.io/guide/retrying-failing-jobs> and <https://docs.bullmq.io/guide/rate-limiting>.

## 11.6 Telemetry

Start with structured JSON logs and trace identifiers in the sample application. Add OpenTelemetry SDK/Collector support as a staged feature. Reuse established semantic conventions where practical.

Official documentation: <https://opentelemetry.io/docs/>.

## 11.7 AI provider abstraction

Define an adapter that supports structured output where available, timeout/abort signals, usage metadata, error classification, bounded retries, model/prompt version configuration, and a deterministic mock provider. Never expose the AI API key to frontend code.

---

# 12. Repository Structure

```text
signalforge/
├── apps/
│   ├── web/                       # Next.js web app and BFF
│   ├── api/                       # Fastify API
│   ├── worker/                    # BullMQ job processors
│   ├── demo-service/              # Instrumented Node.js sample
│   └── verification-runner/       # Restricted scenario runner
├── packages/
│   ├── contracts/                 # Zod schemas and shared types
│   ├── db/                        # Drizzle schema, migrations, repositories
│   ├── auth/                      # Identity and permission logic
│   ├── domain/                    # Domain types and state transitions
│   ├── incident-engine/            # Fingerprinting and correlation rules
│   ├── ai-investigator/            # Provider adapter and validation
│   ├── verification/              # Scenario definitions and result parser
│   ├── observability/              # Logs, traces, metrics helpers
│   ├── config/                    # Shared tooling configuration
│   └── test-fixtures/              # Synthetic events and scenarios
├── infra/
│   ├── docker/
│   ├── otel/
│   └── deployment/
├── docs/
│   ├── architecture.md
│   ├── threat-model.md
│   ├── database.md
│   ├── api.md
│   ├── local-development.md
│   ├── operations.md
│   ├── user-guide.md
│   └── decisions/
├── scripts/
│   ├── seed-demo.ts
│   ├── reset-demo.ts
│   └── verify-environment.ts
├── .github/workflows/
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
├── .env.example
├── .gitignore
├── README.md
└── LICENSE
```

## 12.1 Package boundaries

- `contracts` contains data shapes and validation, not database queries.
- `db` exposes schema, migrations, and repositories, not UI logic.
- `domain` holds business rules and state transitions testable without HTTP.
- `incident-engine` is deterministic and does not invoke an AI provider.
- `ai-investigator` accepts bounded evidence and returns a validated result.
- `verification` defines allowed scenarios and normalizes runner output.
- `observability` centralizes structured logging, metrics, and trace context.

## 12.2 Dependency rule

Application packages can depend on domain and contract packages. The domain layer must not import React, HTTP request objects, database connection singletons, or AI SDKs. Use dependency injection for repositories, queue, provider, and clock interfaces where it improves testing.

---

# 13. Domain Model and Database Schema

## 13.1 Entity relationships

```mermaid
erDiagram
    USERS ||--o{ MEMBERSHIPS : joins
    ORGANIZATIONS ||--o{ MEMBERSHIPS : includes
    ORGANIZATIONS ||--o{ PROJECTS : owns
    PROJECTS ||--o{ ENVIRONMENTS : contains
    PROJECTS ||--o{ SERVICES : contains
    ENVIRONMENTS ||--o{ DEPLOYMENTS : records
    PROJECTS ||--o{ TELEMETRY_EVENTS : receives
    PROJECTS ||--o{ INCIDENTS : tracks
    INCIDENTS ||--o{ INCIDENT_EVENTS : contains
    INCIDENTS ||--o{ INVESTIGATIONS : investigated_by
    INVESTIGATIONS ||--o{ EVIDENCE_ITEMS : uses
    INVESTIGATIONS ||--o{ HYPOTHESES : proposes
    HYPOTHESES ||--o{ HYPOTHESIS_EVIDENCE : references
    EVIDENCE_ITEMS ||--o{ HYPOTHESIS_EVIDENCE : supports
    PROJECTS ||--o{ TEST_SCENARIOS : defines
    INCIDENTS ||--o{ VERIFICATION_RUNS : verified_by
    TEST_SCENARIOS ||--o{ VERIFICATION_RUNS : executed_as
    PROJECTS ||--o{ API_KEYS : authorizes
    ORGANIZATIONS ||--o{ AUDIT_LOGS : records
```

This ER diagram is conceptual. The real schema must enforce consistent organization ownership through foreign keys, validated parent relationships, and tenant-scoped queries.

## 13.2 Data modeling standards

- Use UUIDs or another non-guessable identifier strategy for externally exposed resource IDs.
- Use `timestamptz` for instants and store timestamps in UTC.
- Store source event time separately from ingestion time.
- Use check constraints or database enums for stable status fields.
- Use JSONB for flexible, bounded attributes—not as a replacement for important relational columns.
- Add `created_at` and `updated_at` to mutable records where useful.
- Add `organization_id` to tenant-owned tables when it helps enforce consistency and simplify authorization.
- Use composite foreign keys where needed to prevent cross-organization relationships.
- Keep raw and normalized telemetry fields conceptually distinct.
- Store hashes or secure verifiers for API keys, never reusable plaintext key material.

## 13.3 Proposed PostgreSQL schema

The following SQL is a detailed starting point, not a drop-in production migration. Validate it against your chosen PostgreSQL version and Drizzle schema. The `ON DELETE SET NULL` behavior on composite foreign keys, tenant consistency across junction tables, and authentication-library-specific tables require particular attention before applying it.

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free'
    CHECK (plan IN ('free', 'team', 'internal')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX idx_memberships_user ON memberships(user_id, organization_id);

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug),
  UNIQUE (organization_id, id)
);
CREATE INDEX idx_projects_org_created
  ON projects(organization_id, created_at DESC);

CREATE TABLE environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, slug),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  name TEXT NOT NULL,
  service_key TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, service_key),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  environment_id UUID NOT NULL,
  version TEXT NOT NULL,
  commit_sha TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('started', 'succeeded', 'failed', 'rolled_back', 'unknown')),
  deployed_at TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'manual',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, environment_id)
    REFERENCES environments(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_deployments_environment_time
  ON deployments(organization_id, environment_id, deployed_at DESC);

CREATE TABLE telemetry_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  environment_id UUID,
  service_id UUID,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('log', 'error', 'trace', 'metric', 'deployment', 'custom')),
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical', 'unknown')),
  occurred_at TIMESTAMPTZ NOT NULL,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  trace_id TEXT,
  span_id TEXT,
  fingerprint TEXT,
  message TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  redaction_version TEXT NOT NULL DEFAULT 'v1',
  idempotency_key TEXT,
  content_hash TEXT,
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, environment_id)
    REFERENCES environments(organization_id, id),
  FOREIGN KEY (organization_id, service_id)
    REFERENCES services(organization_id, id)
);
CREATE UNIQUE INDEX uq_events_idempotency
  ON telemetry_events(organization_id, project_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX idx_events_project_time
  ON telemetry_events(organization_id, project_id, occurred_at DESC);
CREATE INDEX idx_events_fingerprint_time
  ON telemetry_events(organization_id, fingerprint, occurred_at DESC)
  WHERE fingerprint IS NOT NULL;
CREATE INDEX idx_events_trace
  ON telemetry_events(organization_id, trace_id)
  WHERE trace_id IS NOT NULL;
CREATE INDEX idx_events_type_severity_time
  ON telemetry_events(organization_id, project_id, event_type, severity, occurred_at DESC);

CREATE TABLE incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  environment_id UUID,
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'monitoring', 'resolved', 'ignored')),
  severity TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 1 CHECK (event_count >= 0),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, environment_id)
    REFERENCES environments(organization_id, id)
);
CREATE INDEX idx_incidents_org_status_time
  ON incidents(organization_id, status, first_seen_at DESC);
CREATE INDEX idx_incidents_project_time
  ON incidents(organization_id, project_id, first_seen_at DESC);

CREATE TABLE incident_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL,
  telemetry_event_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, incident_id)
    REFERENCES incidents(organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (telemetry_event_id) REFERENCES telemetry_events(id) ON DELETE SET NULL
);
CREATE INDEX idx_incident_events_time
  ON incident_events(organization_id, incident_id, created_at ASC);

CREATE TABLE investigations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  summary TEXT,
  error_code TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_amount NUMERIC(12, 6),
  cost_currency TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, incident_id)
    REFERENCES incidents(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_investigations_incident_time
  ON investigations(organization_id, incident_id, created_at DESC);

CREATE TABLE evidence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investigation_id UUID NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  source_occurred_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, investigation_id)
    REFERENCES investigations(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_evidence_investigation
  ON evidence_items(organization_id, investigation_id, captured_at ASC);

CREATE TABLE hypotheses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  investigation_id UUID NOT NULL,
  claim TEXT NOT NULL,
  rationale TEXT NOT NULL,
  confidence_label TEXT NOT NULL
    CHECK (confidence_label IN ('low', 'medium', 'high', 'unknown')),
  status TEXT NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'accepted_for_testing', 'rejected', 'verified', 'inconclusive')),
  proposed_check TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, investigation_id)
    REFERENCES investigations(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE hypothesis_evidence (
  hypothesis_id UUID NOT NULL REFERENCES hypotheses(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL REFERENCES evidence_items(id) ON DELETE CASCADE,
  relationship TEXT NOT NULL CHECK (relationship IN ('supports', 'contradicts', 'context')),
  explanation TEXT,
  PRIMARY KEY (hypothesis_id, evidence_id, relationship)
);

CREATE TABLE test_scenarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  name TEXT NOT NULL,
  scenario_key TEXT NOT NULL,
  description TEXT NOT NULL,
  scenario_version TEXT NOT NULL,
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, scenario_key),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE verification_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  incident_id UUID NOT NULL,
  scenario_id UUID NOT NULL REFERENCES test_scenarios(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'passed', 'failed', 'error', 'timed_out', 'cancelled')),
  commit_sha TEXT,
  scenario_version TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  summary TEXT,
  report JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code TEXT,
  triggered_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, incident_id)
    REFERENCES incidents(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_verification_runs_incident_time
  ON verification_runs(organization_id, incident_id, created_at DESC);

CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL DEFAULT ARRAY['events:write'],
  expires_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_api_keys_project_active
  ON api_keys(organization_id, project_id, created_at DESC)
  WHERE revoked_at IS NULL;

CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID,
  provider TEXT NOT NULL,
  external_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'connected', 'error', 'revoked')),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  secret_reference TEXT,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, project_id)
    REFERENCES projects(organization_id, id) ON DELETE CASCADE
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  request_id TEXT,
  outcome TEXT NOT NULL DEFAULT 'success'
    CHECK (outcome IN ('success', 'denied', 'failure')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_org_time
  ON audit_logs(organization_id, created_at DESC);
CREATE INDEX idx_audit_logs_resource
  ON audit_logs(organization_id, resource_type, resource_id, created_at DESC);
```

## 13.4 Schema review notes

The starter schema requires a deliberate review before production:

- Composite foreign keys on nullable relationships require careful handling. `ON DELETE SET NULL` may need a column list or an alternative constraint, depending on the schema and PostgreSQL version.
- If `incident_events.telemetry_event_id` must be guaranteed to belong to the same organization, add composite keys or enforce the relationship in a transaction.
- The `hypothesis_evidence` junction should guarantee that both records belong to the same investigation and organization. This may require denormalized ownership columns, composite unique constraints, or a dedicated insert service with strong database constraints.
- `integrations.secret_reference` should point to a secret manager or encrypted secret record. Never store raw provider access tokens in `config` JSONB.
- Add authentication-library-specific account/session tables as required.
- Use `EXPLAIN ANALYZE` to verify indexes for real query patterns before adding more indexes.
- Decide whether deletion cascades are compatible with audit requirements and retention policy. Soft deletion may be preferable for some records.

## 13.5 Required tenant constraints

Before public release, enforce that every project belongs to one organization; every incident belongs to the same organization as its project; every investigation belongs to the same organization as its incident; each evidence item belongs to the same organization as its investigation; hypothesis/evidence links cannot cross investigations; each verification run uses a scenario permitted for the same project and organization; and each API key is restricted to its assigned project and scopes.

## 13.6 State transitions

Validate transitions in domain functions rather than accepting arbitrary status strings through generic PATCH endpoints.

**Incident lifecycle:**

```text
open -> investigating -> monitoring -> resolved
  |            |             |
  +------------+-------------+----> ignored (if permitted)
```

An incident may reopen when new events satisfy a documented rule. Reopening appends an incident event and an audit record rather than silently overwriting history.

**Investigation lifecycle:**

```text
queued -> running -> completed
                   -> failed
                   -> cancelled
```

A completed investigation is an immutable record of one run. Re-investigation creates another record linked to the incident.

**Verification lifecycle:**

```text
queued -> running -> passed
                   -> failed
                   -> error
                   -> timed_out
                   -> cancelled
```

Only the verification-result service can assign terminal status from runner output. The model cannot mark a run as passed.

---

# 14. Data Retention, Indexing, and Query Strategy

## 14.1 Retention principles

Telemetry can grow quickly and may contain confidential information. Define retention windows for raw events, incidents, evidence packages, audit logs, and verification reports. Keep the policy configurable by environment and plan. Do not promise a duration until the deletion workflow has been implemented and tested.

## 14.2 Starting retention policy

A demo might retain raw telemetry for 7–14 days while keeping selected incident reports and audit records longer. These are only starting values. Adjust them after measuring volume, privacy needs, infrastructure limits, and applicable obligations.

## 14.3 Query discipline

- Paginate every list endpoint.
- Set a maximum page size.
- Bound time ranges for telemetry searches.
- Select only fields needed by the view.
- Avoid loading every event into memory for correlation.
- Bound JSONB attributes and validate allowed keys.
- Analyze slow queries using database query plans.
- Do not introduce time-series or vector-search infrastructure before a measured need exists.

## 14.4 Retention worker

A scheduled job can identify records beyond their cutoff, delete or anonymize them according to policy, preserve only what is required for audit, record sanitized outcomes, and report failures. Deletion should be performed in bounded batches and be restartable without damaging other tenants' data.

---

# 15. API Architecture and Endpoint Specifications

## 15.1 Conventions

- Prefix versioned routes with `/v1`.
- Use JSON except where a documented streaming protocol applies.
- Use one consistent error envelope.
- Use UUIDs for resource IDs in the initial design.
- Use UTC ISO-8601 timestamps.
- Include a request ID in every response and server log.
- Enforce organization and project scope on the server.
- Use idempotency keys for retried writes.
- Return `202 Accepted` for asynchronous operations.
- Return `429 Too Many Requests` with safe retry information where appropriate.
- Never return raw stack traces, SQL errors, or internal provider errors.

## 15.2 Error envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "One or more fields are invalid.",
    "requestId": "req_01JEXAMPLE",
    "details": [
      { "field": "occurredAt", "issue": "Expected an ISO-8601 timestamp." }
    ]
  }
}
```

## 15.3 Identity and organization routes

If authentication is provided by a supported identity solution, use its established session routes instead of rebuilding password management without a clear reason. Application endpoints may include:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/me` | Current identity/profile |
| `GET` | `/v1/me/organizations` | Authorized organization list |
| `POST` | `/v1/organizations` | Create organization and owner membership transactionally |
| `GET` | `/v1/organizations/:organizationId/members` | List members, if permitted |
| `POST` | `/v1/organizations/:organizationId/invitations` | Invite a member |
| `PATCH` | `/v1/organizations/:organizationId/members/:userId` | Change permitted role |
| `DELETE` | `/v1/organizations/:organizationId/members/:userId` | Revoke membership, if permitted |

Validate role transitions, invitation expiry, duplicate invitations, and last-owner protection.

## 15.4 Projects, environments, services, deployments

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/projects` | List projects with pagination |
| `POST` | `/v1/projects` | Create project |
| `GET` | `/v1/projects/:projectId` | Read project |
| `PATCH` | `/v1/projects/:projectId` | Update permitted fields |
| `GET` | `/v1/projects/:projectId/environments` | List environments |
| `POST` | `/v1/projects/:projectId/environments` | Create environment |
| `GET` | `/v1/projects/:projectId/services` | List services |
| `POST` | `/v1/projects/:projectId/services` | Register a service |
| `GET` | `/v1/projects/:projectId/deployments` | Deployment history |
| `POST` | `/v1/projects/:projectId/deployments` | Record deployment |

## 15.5 Telemetry ingestion

**Endpoint:** `POST /v1/ingest/events`  
**Authentication:** project-scoped key with `events:write` scope.

Enforce payload size, batch count, timestamp bounds, message length, attributes schema, redaction, rate limiting, key expiry/revocation, and idempotency.

Example request:

```http
POST /v1/ingest/events
Authorization: Bearer sf_live_REDACTED
Content-Type: application/json
Idempotency-Key: checkout-demo-evt-0001
```

```json
{
  "eventType": "error",
  "occurredAt": "2026-10-26T10:30:00Z",
  "service": "checkout-api",
  "environment": "staging",
  "severity": "error",
  "traceId": "example-trace-8f21",
  "message": "Database query failed",
  "attributes": {
    "http.status_code": 500,
    "deployment.version": "v1.4.2"
  }
}
```

Example response:

```json
{
  "data": {
    "eventId": "3e62dc27-9a13-48bf-9651-28e223731213",
    "accepted": true,
    "duplicate": false,
    "ingestedAt": "2026-10-26T10:30:01Z"
  },
  "requestId": "req_example"
}
```

The IDs and timestamps are illustrative, not real results.

### Ingestion validation rules

- Reject unknown event types.
- Reject timestamps outside documented age/future bounds.
- Limit message length, serialized payload size, attribute depth, key count, and value length.
- Redact known secret patterns where practical.
- Validate that the referenced service and environment belong to the key's project.
- Do not trust names in the event body as authorization scope.
- Apply per-key and per-organization limits.
- Return consistent behavior for replayed idempotency keys during the supported window.

## 15.6 Incident routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/projects/:projectId/incidents` | Filtered incident list |
| `GET` | `/v1/incidents/:incidentId` | Incident details |
| `GET` | `/v1/incidents/:incidentId/events` | Timeline |
| `PATCH` | `/v1/incidents/:incidentId/status` | Validated state transition |
| `GET` | `/v1/incidents/:incidentId/investigations` | Investigation history |
| `GET` | `/v1/incidents/:incidentId/verification-runs` | Verification history |

Do not expose an unrestricted generic status field that allows the client to skip lifecycle rules.

## 15.7 Investigation routes

`POST /v1/incidents/:incidentId/investigations` creates an investigation and returns `202 Accepted` plus an ID and status URL.

Request:

```json
{
  "mode": "evidence_based",
  "includeDeploymentHistory": true,
  "includeRelatedEvents": true
}
```

Example response:

```json
{
  "data": {
    "investigationId": "7aa6b5ae-11c9-4dbd-9a3a-10f4a086f115",
    "status": "queued",
    "statusUrl": "/v1/investigations/7aa6b5ae-11c9-4dbd-9a3a-10f4a086f115"
  },
  "requestId": "req_example"
}
```

Additional endpoints:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/investigations/:investigationId` | Status and report |
| `GET` | `/v1/investigations/:investigationId/evidence` | Persisted evidence |
| `GET` | `/v1/investigations/:investigationId/hypotheses` | Hypotheses and links |
| `POST` | `/v1/investigations/:investigationId/cancel` | Request cancellation where supported |

After dequeueing a job, the worker must re-read authoritative resources. Job payload IDs are not proof of ownership or authorization.

## 15.8 Verification routes

`POST /v1/incidents/:incidentId/verification-runs` creates a run and returns `202 Accepted`.

Request:

```json
{
  "scenarioId": "d04ee70a-b10d-467f-a0b1-67a2df75e1d8",
  "commitSha": "optional-commit-reference"
}
```

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/verification-runs/:runId` | Result and safe summary |
| `GET` | `/v1/projects/:projectId/test-scenarios` | List enabled scenarios |
| `POST` | `/v1/projects/:projectId/test-scenarios` | Create a supported scenario, if permitted |
| `PATCH` | `/v1/test-scenarios/:scenarioId` | Update safe metadata or enablement |

Prefer a small set of built-in scenarios over arbitrary user-defined commands in the MVP.

## 15.9 API keys and integrations

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/projects/:projectId/api-keys` | List metadata only |
| `POST` | `/v1/projects/:projectId/api-keys` | Create scoped key |
| `DELETE` | `/v1/api-keys/:keyId` | Revoke key |
| `GET` | `/v1/projects/:projectId/integrations` | List integration metadata |
| `POST` | `/v1/projects/:projectId/integrations` | Initiate integration |
| `DELETE` | `/v1/integrations/:integrationId` | Revoke integration |

Never return key hashes, provider secrets, refresh tokens, or internal secret references to ordinary clients.

## 15.10 Pagination

Prefer cursor pagination for event and incident feeds:

```json
{
  "data": [],
  "page": { "nextCursor": null, "hasMore": false },
  "requestId": "req_example"
}
```

Validate cursors and bind them to the organization and filter context. A cursor must never bypass authorization.

## 15.11 Streaming

`GET /v1/projects/:projectId/events/stream` can use Server-Sent Events for status notifications. Authenticate and authorize before subscribing. Revalidate or expire long-running sessions according to the session strategy. Stream minimal metadata and require clients to fetch full records using normal authorized endpoints.

## 15.12 OpenAPI and contract testing

Document authentication, permissions, request/response schemas, errors, idempotency, pagination, rate limits, and audit requirements for every endpoint. Run contract tests in CI to prevent drift between implementation and API documentation.

---

# 16. Event Ingestion and Correlation Engine

## 16.1 Event normalization

Normalize incoming events into a stable internal shape. Preserve only required or approved fields. Keep source and ingestion timestamps separate. Attach project, service, and environment based on validated server-side identifiers, not arbitrary names supplied in an event body.

## 16.2 Fingerprinting

An initial fingerprint may use event type, service, environment, exception class, normalized message template, stack-frame signature, and HTTP route template. Avoid dynamic request IDs, random UUIDs, and raw values that cause identical errors to be split into separate incidents.

Hash the canonicalized input. Keep a safe diagnostic representation of the normalized fields so grouping behavior can be explained.

## 16.3 Grouping rules

1. An event with an existing fingerprint inside the active grouping window attaches to the existing incident.
2. Update `last_seen_at` and event count transactionally.
3. Severity can be raised when a more severe event arrives; lowering requires an explicit rule.
4. A quiet period can close the grouping window, but does not prove that the service is fixed.
5. Events from different organizations must never share an incident.
6. Events from separate environments should normally be separate.
7. Record the grouping algorithm version for explainability and later comparison.

## 16.4 Deployment correlation

For an incident beginning at time `t`, collect deployments for the same project/environment in a bounded lookback, such as 30–60 minutes. Treat this as a heuristic, not a causal conclusion.

Suggested UI language:

> A deployment occurred 8 minutes before the first observed error. This is a temporal correlation, not proof that the deployment caused the incident.

Useful features include time distance between deployment and first error, change in event frequency before/after deployment, matching service/environment, whether the error existed beforehand, and whether a controlled test changes the result.

The engine should output structured features, not definitive causal claims unsupported by a separate verification method.

## 16.5 Evidence selection

For each investigation:

1. Load and authorize the incident and parent project.
2. Retrieve first/last-seen times and fingerprint.
3. Fetch related events within a bounded time range.
4. Fetch recent deployments for the same project/environment.
5. Fetch traces sharing a validated trace ID where available.
6. Fetch prior verification runs and relevant scenarios.
7. Redact sensitive fields and truncate long content.
8. Normalize evidence order and calculate hashes.
9. Persist the bounded evidence package.
10. Build the model prompt from persisted evidence, not from an unbounded live query.

A starting limit might be 20–50 relevant events, a small number of deployments, and a few trace summaries. Tune limits using evaluation and cost measurements.

## 16.6 Transactional consistency

An event may be committed even if queue dispatch fails. To avoid losing correlation work, consider a transactional outbox:

- Persist the event and an outbox item in one transaction.
- Dispatcher publishes unsent items.
- Mark items delivered after successful publication.
- Make workers idempotent because at-least-once delivery may repeat work.

A prototype may choose a simpler scheme, but it must document how partial failure is recovered. Do not claim durable acceptance if neither the event nor a durable work item was recorded.

## 16.7 Required fixtures

Test an error immediately after deployment; repeated events with identical fingerprints; the same error in two environments; the same error across two organizations; late-arriving events; timestamps outside bounds; duplicate idempotency keys; oversized attributes; log content containing fake secrets or instruction-like text; and events referencing another project's service.

---

# 17. AI Investigation Pipeline

## 17.1 Responsibility boundary

AI may summarize, compare observations, rank plausible hypotheses, and suggest verification checks. It cannot authorize access, query arbitrary resources, execute commands, decide a test passed, or update incident status directly.

## 17.2 Input contract

```ts
export interface InvestigationContext {
  investigationId: string;
  incident: {
    id: string;
    title: string;
    severity: string;
    firstSeenAt: string;
    lastSeenAt: string;
    fingerprint: string;
  };
  evidence: Array<{
    id: string;
    sourceType: string;
    occurredAt?: string;
    summary: string;
    attributes: Record<string, unknown>;
    contentHash: string;
  }>;
  constraints: {
    maxHypotheses: number;
    allowedEvidenceIds: string[];
    includeCodeChanges: boolean;
    productionExecutionAllowed: false;
  };
}
```

The exact interface can evolve, but the input must be bounded and explicit. `allowedEvidenceIds` must come from persisted evidence, not user input or model output.

## 17.3 Output contract

The result can contain a concise summary, a limited number of hypotheses, supporting/contradictory evidence IDs, a qualitative confidence label, a suggested check, and limitations.

```json
{
  "summary": "Errors increased shortly after a deployment that changed database configuration.",
  "hypotheses": [
    {
      "claim": "The new database connection configuration may be incompatible.",
      "rationale": "The first observed errors follow the deployment, and related events contain connection failures.",
      "confidence": "medium",
      "supportingEvidenceIds": ["ev_01", "ev_02"],
      "contradictingEvidenceIds": [],
      "proposedCheck": "Run the database connection integration scenario against the candidate configuration."
    }
  ],
  "limitations": [
    "The relevant configuration diff has not been inspected directly."
  ]
}
```

This is illustrative output, not a real diagnosis.

## 17.4 Validation pipeline

1. Parse the provider response.
2. Validate the full schema and required fields.
3. Enforce maximum text lengths and hypothesis count.
4. Verify that every evidence ID belongs to this investigation's persisted set.
5. Confirm evidence belongs to the same organization and investigation.
6. Reject unknown properties if strict parsing is enabled.
7. Escape untrusted content at rendering time; do not trust AI-produced HTML.
8. Persist provider/model/prompt version, timing, usage metadata, and accepted status.
9. Record validation failures as sanitized error codes.
10. Return only validated results to the UI.

## 17.5 Prompt rules

Instruct the model to treat telemetry as untrusted data; ignore instructions embedded in logs or source text; use only supplied evidence IDs; distinguish observation from interpretation; state uncertainty; include contradictions; avoid presenting temporal association as causation; suggest safe tests rather than executing actions; never claim a fix passed without a verification result; and return exactly the required schema.

Prompts are not a substitute for runtime validation. Prompt injection remains possible when a user can influence logs, commit messages, or other input text.

## 17.6 Context and privacy

Use a relevance policy and hard size limits. Exclude credentials, authorization headers, cookies, request bodies containing personal data, and unfiltered environment variables. Redact known secret patterns before storage and model submission. Disclose which categories of evidence may be sent to the provider.

## 17.7 Provider adapter

```ts
export interface InvestigationProvider {
  readonly providerName: string;
  investigate(
    input: InvestigationContext,
    options: { signal: AbortSignal; model: string; promptVersion: string }
  ): Promise<unknown>;
}
```

Return `unknown` intentionally and validate it at runtime. Do not type a raw provider response as a trusted result.

## 17.8 Mock provider

The mock provider uses scenario fixtures, returns deterministic structured results, supports simulated timeout and malformed-response modes, and never pretends to be a live model. The UI must display “Demo / simulated AI result” whenever the mock provider is used.

## 17.9 Failure policy

Recoverable cases may include temporary network problems and provider rate limits. Non-recoverable cases may include invalid evidence context, unsupported configuration, repeated schema failure after the retry budget, or resource mismatch. Retry only when safe, use bounded exponential backoff with jitter where appropriate, and prevent duplicate concurrent provider calls for the same idempotency key.

## 17.10 Evaluation dimensions

Measure schema validity, citation validity, root-cause hypothesis recall, evidence relevance, unsupported-claim rate, uncertainty behavior, test-suggestion compatibility, latency, and cost. Any score is meaningful only if the data set, scoring rules, and limitations are documented.

---

# 18. Verification Engine and Safe Execution

## 18.1 Purpose

Verification tests a specific claim under defined conditions. It must not promise that the entire production service is healthy.

Precise statement:

> The database-connection integration scenario passed against commit `abc123` in the isolated demo environment.

Overbroad statement to avoid:

> The incident is fixed forever.

## 18.2 MVP scenarios

Start with a few built-in scenario types:

- HTTP health check.
- Predefined integration test in a trusted image.
- Deterministic unit-test bundle in the demo image.
- Simulated before/after failure scenario.

Do not allow arbitrary user-entered shell commands. Map a server-approved scenario key to a fixed executable and argument list. Never interpolate untrusted input into a shell command.

## 18.3 Runner isolation

Use a separate container or short-lived isolated environment with:

- Non-root execution.
- No Docker socket mounted inside the runner.
- No host filesystem access beyond approved temporary files.
- No production credentials.
- Network access disabled by default or restricted to necessary demo dependencies.
- CPU, memory, process, and time limits.
- Read-only root filesystem where practical.
- Temporary workspace cleanup.
- Output size limits and secret redaction.

The runner must never be a public arbitrary-command endpoint.

## 18.4 Verification record

Persist scenario ID and immutable version, incident and organization IDs, triggering user, commit/build identifier, timestamps, duration, terminal status, structured assertions, sanitized output summary, and operational error code when relevant.

Distinguish a test failure from an infrastructure error. A scenario that could not start should be `error` or `timed_out`, not `failed` if the test itself never ran.

## 18.5 Status semantics

- `passed`: all required assertions passed.
- `failed`: at least one required assertion failed.
- `error`: the runner could not reliably execute or report the scenario.
- `timed_out`: execution exceeded its limit.
- `cancelled`: an authorized cancellation completed.

Only deterministic processing of runner output can assign these statuses.

## 18.6 Demo scenarios

**Known failure:** A sample endpoint reads deliberately misconfigured data or calls a controlled failing dependency; telemetry records the result.

**Corrected configuration:** A test parameter or sample change represents a fix, and a verification scenario checks the expected HTTP and database behavior.

**Distractor event:** A separate event appears nearby in time but is not relevant to the main issue. This checks whether the AI recognizes uncertainty and contradictory evidence.

Never run destructive scenarios against real customer data.

---

# 19. Frontend Information Architecture

## 19.1 Public pages

- `/` — product landing page.
- `/product` — workflow and capabilities.
- `/security` — data handling and trust boundaries.
- `/docs` — documentation index.
- `/demo` — entry point for seeded demo.
- `/pricing` — only if a pricing hypothesis is being tested.
- `/sign-in` — authentication.
- `/privacy` and `/terms` — publish only after appropriate review.

## 19.2 Authenticated application pages

- `/app` — overview.
- `/app/organizations` — organization selector and creation.
- `/app/settings/organization` — members, roles, and settings.
- `/app/projects` — project listing.
- `/app/projects/[projectId]` — project overview.
- `/app/projects/[projectId]/incidents` — incident explorer.
- `/app/incidents/[incidentId]` — incident workspace.
- `/app/investigations/[investigationId]` — investigation report.
- `/app/verification/[runId]` — verification detail.
- `/app/projects/[projectId]/deployments` — deployment history.
- `/app/projects/[projectId]/settings` — project configuration.
- `/app/projects/[projectId]/api-keys` — key management.
- `/app/projects/[projectId]/integrations` — integration settings.
- `/app/audit` — audit records where permitted.

## 19.3 Application shell

Use a compact left sidebar on desktop and an accessible navigation drawer on smaller screens. Include an organization switcher, project selector, overview, incidents, deployments, verification, integrations, settings, documentation/help, and current-user menu. Show the selected environment prominently on environment-specific views. Never use color as the sole indication of severity or status.

## 19.4 Overview dashboard

The overview should contain:

1. Header with project/environment and a clear demo action.
2. Summary metrics: open incidents, recent deployments, error trend, active investigations.
3. Error-rate and incident trend charts with accessible descriptions and time range controls.
4. Recent incidents table.
5. Deployment timeline.
6. Worker/integration health.
7. An empty state with a CTA to seed a demo scenario.

Do not display random numbers as if they were live telemetry. Use labelled synthetic data or measurements with source and time window.

## 19.5 Incident explorer

Provide search by title/fingerprint, filters for status/severity/service/environment/time, sorting by first-seen/last-seen/severity/count, and pagination. Include clear states for no records, no filter matches, loading, and API failure. Make row actions keyboard-accessible.

## 19.6 Incident workspace layout

Recommended layout:

- **Header:** title, severity, status, first/last seen, and permitted actions.
- **Main panel:** event and deployment timeline.
- **Secondary panel:** AI investigation hypotheses.
- **Evidence drawer:** selected event, trace, or deployment details.
- **History tab:** previous investigations and verification runs.

On narrower screens, stack panels and make the evidence view accessible without horizontal scrolling.

## 19.7 Investigation report

For each hypothesis, show the claim, qualitative confidence label, supporting and contradicting evidence links, a suggested verification step, known limitations, and investigation timestamp. Display provider/model metadata where useful, without exposing private prompt internals or secrets. Every evidence link must open the exact persisted item. An invalid reference should cause the result to be rejected rather than rendered as a guessed link.

## 19.8 Verification detail

Show scenario and version, environment type, commit/build identifier, timestamps, duration, terminal outcome, individual assertions and actual values, sanitized failure output, and links back to the incident and investigation. A passed scenario must not imply that all possible causes have been disproved or that a service is permanently healthy.

## 19.9 Settings UX

API key management must explain that plaintext is shown once. Include create, copy, expiry, scope, last-used, and revoke actions. Require confirmation for revocation and explain its impact. Never allow users to recover plaintext from a stored hash.

---

# 20. UI/UX Design System

## 20.1 Visual direction

Use a professional dark-first developer-tool aesthetic. Prioritize readability, data comparison, timelines, and clear states. Avoid decorative 3D effects, animated background particles, excessive glassmorphism, and oversized marketing typography in the product interface.

Suggested tokens:

| Token | Example | Use |
|---|---|---|
| Background | `#101722` | Main canvas |
| Surface | `#1B2735` | Panels and menus |
| Primary | `#3978E8` | Main action and focus |
| Healthy | `#159E91` | Confirmed healthy state |
| Warning | `#D69A28` | Warning state |
| Critical | `#D94D5C` | Critical state |
| Text primary | `#F3F6FA` | Main content |
| Text muted | `#AAB6C5` | Secondary content |
| Border | `#324153` | Dividers and boundaries |

These are starting tokens. Verify contrast for actual text sizes, hover states, and disabled states.

## 20.2 Typography

Use a readable UI font such as Inter or a system sans-serif stack. Use a monospace font for timestamps, IDs, logs, stack traces, commit hashes, and structured data. Tabular numerals can improve scanning in time-series summaries.

## 20.3 Component inventory

Build reusable components for the app shell; project/environment selectors; breadcrumbs and page headers; status and severity indicators; metric summaries; time-series charts; incident tables; timeline events; trace summaries; evidence references and detail drawers; hypothesis panels; verification results; job status; empty/loading/error states; confirmation dialogs; reveal-once API-key panel; toast/alert messages; filters and pagination.

Use design tokens instead of styling every component independently.

## 20.4 Required interaction states

Every data-driven page needs initial loading, refresh, empty data, no filter matches, validation error, expired authentication, permission denied, rate limit, queued job, running job, success, recoverable failure, and terminal failure states.

## 20.5 Accessibility checklist

- All actions work by keyboard.
- Focus order follows visual order.
- Focus indicators are visible.
- Dialogs manage focus correctly.
- Form controls have persistent accessible labels.
- Charts have textual descriptions or accessible data alternatives.
- Severity is not communicated by color alone.
- Motion respects reduced-motion preferences.
- Tables have meaningful headers.
- Errors are associated with relevant controls/actions.
- Live updates do not overwhelm assistive technology.

## 20.6 Responsive behavior

At desktop widths, use a sidebar and split incident workspace. At tablet widths, allow the sidebar to collapse. At mobile widths, make tables manageable or convert rows into stacked summaries. Move evidence and investigation panels into tabs/drawers rather than forcing a narrow multi-column layout.

## 20.7 Copywriting principles

Use precise language:

- “Likely cause,” not “root cause confirmed,” unless independently verified.
- “Related deployment,” not “causing deployment.”
- “Scenario passed,” not “system fixed,” when only one test ran.
- “Evidence unavailable,” not silent omission.
- “Simulated result” when the mock AI provider is active.

---

# 21. Authentication, Authorization, and Tenant Isolation

## 21.1 Security model

The organization is the tenant boundary. Users gain access through active membership. Projects, environments, services, incidents, investigations, evidence, verification runs, API keys, integrations, and audit records are accessible only through an authorized organization context.

Every request must derive identity from validated credentials. Do not trust a user ID, organization ID, or role that appears only in request JSON or browser-provided headers.

## 21.2 Authorization sequence

For each tenant-scoped request:

1. Authenticate the request.
2. Resolve the current actor.
3. Resolve the organization from authorized server-side context.
4. Check active membership.
5. Check role/permission for the action.
6. Verify target and parent resource ownership.
7. Validate permitted fields and state transitions.
8. Execute the operation transactionally where required.
9. Write the required audit event.
10. Return only fields the actor may see.

## 21.3 Avoid broken object-level authorization

Unsafe conceptual pattern:

```ts
const incident = await db.query.incidents.findFirst({
  where: eq(incidents.id, incidentId),
});
```

Tenant-scoped pattern:

```ts
const incident = await db.query.incidents.findFirst({
  where: and(
    eq(incidents.id, incidentId),
    eq(incidents.organizationId, authorizedOrganizationId),
  ),
});
```

This is illustrative; match the actual Drizzle version and imports. The essential rule is to scope the query and validate parent ownership.

## 21.4 PostgreSQL Row-Level Security

RLS can provide defense in depth where tenant context can be set safely. Use the same non-owner, non-superuser role for runtime requests that is used in production. A conceptual policy is:

```sql
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;

CREATE POLICY projects_tenant_policy ON projects
  USING (
    organization_id = current_setting('app.organization_id', true)::uuid
  )
  WITH CHECK (
    organization_id = current_setting('app.organization_id', true)::uuid
  );
```

This is not a complete implementation. Set context transactionally, reset it safely for pooled connections, and test missing/invalid context and connection reuse. RLS does not replace application authorization. Database owners and roles with bypass privileges can circumvent policies unless configured appropriately.

Official reference: <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>

## 21.5 API key design

A project key should combine a public identifier/prefix with a high-entropy secret. On creation, generate cryptographically secure random material, show it once, store a secure hash or keyed hash and non-secret metadata, and associate the key with one project and explicit scopes. Record creation and optional expiry.

For lookup, use a non-secret key ID/prefix and a safe verification approach appropriate to the token entropy. A high-entropy random key does not need to be treated exactly like a human password, but the verifier must be designed carefully and secrets must never be stored in plaintext. Keys must be revocable; rotation should permit testing the replacement before revoking the original.

## 21.6 Tenant isolation test matrix

Create Organization A and Organization B with separate users, projects, keys, incidents, investigations, evidence, and verification runs. Attempt to read another organization's project by UUID, modify its incident, fetch its investigation, run a scenario on its incident, subscribe to its SSE stream, use one tenant's key for another tenant's project, read another investigation's evidence, and submit mismatched service/environment identifiers. Every unauthorized operation must be denied without unnecessary existence leaks.

---

# 22. Security and Threat Model

## 22.1 Threat actors

Consider an unauthenticated user, a read-only user, a compromised project key, a malicious organization member, malicious text in logs/commits, a compromised integration token, a faulty job payload, an attacker targeting the verification runner, and a developer who accidentally ships a secret or debug route.

## 22.2 Assets

Protect user sessions, membership records, telemetry, incidents, evidence, API keys, integration credentials, AI provider credentials, verification infrastructure, audit records, database backups, and deployment configuration.

## 22.3 Risks and controls

| Risk | Example | Control |
|---|---|---|
| Broken object authorization | Change an incident ID to access another tenant | Tenant-scoped queries, parent checks, RLS where appropriate, negative tests |
| Broken authentication | Reuse a stolen session or key | Secure cookies, expiry/revocation, rate limits, optional MFA for privileged accounts |
| Resource exhaustion | Submit huge event batches or trigger excessive AI jobs | Body limits, quotas, bounded concurrency, deduplication, tenant budgets |
| Prompt injection | A log asks the AI to reveal secrets | Treat logs as data; no privileged tools; bounded context |
| SSRF | Integration URL points to internal metadata service | Destination allowlist, DNS/IP validation, redirect controls, outbound restrictions |
| Secret leakage | Key appears in logs or model context | Redaction, allowlisted fields, secret scanning, minimal context |
| Unsafe code execution | User submits shell command to runner | Built-in scenario registry, isolation, no arbitrary command endpoint |
| Excessive privileges | Worker has access to secrets it does not need | Per-service identities and least privilege |
| Unsafe output rendering | Log contains HTML or script | Escape output; never render untrusted content as raw HTML |
| Webhook spoofing | Forged integration callback | Verify signature, timestamp, replay window where supported |
| Race conditions | Duplicate incident from concurrent jobs | Constraints, transactions, idempotent consumers |
| Detailed error leakage | SQL/provider response returned to browser | Safe error mapping, detailed server-side logs only |

OWASP API Security reference: <https://owasp.org/API-Security/editions/2023/en/>.

## 22.4 Browser security

Configure HTTPS, HSTS when HTTPS is guaranteed, an appropriate Content Security Policy, frame protections, referrer policy, and content-type sniffing protection. Use an explicit CORS allowlist. Avoid wildcard CORS for credentialed requests.

Cookie-based state-changing requests need appropriate CSRF protection. SameSite cookies reduce some risks but should not automatically be treated as the only control.

## 22.5 SSRF controls

If an integration fetches user-controlled URLs, prefer fixed provider endpoints; allowlist schemes/hosts; block loopback, private, link-local, multicast, and metadata IP ranges as appropriate; revalidate redirects or disable them; apply connection and response timeouts; limit response size; do not forward credentials across hosts; and restrict outbound network traffic at infrastructure level where possible.

## 22.6 Security logging

Record actor, action, resource, outcome, timestamp, and request ID. Never log passwords, full API keys, cookies, authorization headers, database URLs, model secrets, or unredacted sensitive prompts. Restrict audit access and apply retention controls.

## 22.7 Dependency and supply-chain controls

- Commit lockfiles and manage dependency updates deliberately.
- Run dependency vulnerability checks and secret scanning in CI.
- Review package maintenance and ownership where risk warrants it.
- Use minimal container images and non-root execution where possible.
- Produce a basic software bill of materials if feasible.
- Document the dependency update process.

## 22.8 Incident response

Document how to revoke keys, invalidate sessions, disable a compromised integration, pause verification, rotate provider credentials, and restore backups. A solo portfolio project still benefits from a short incident-response runbook.

---

# 23. Privacy and Data Governance

## 23.1 Data classification

- **Public:** marketing pages and public docs.
- **Internal:** project metadata and ordinary configuration.
- **Sensitive:** logs, traces, commit metadata, investigation content, key metadata, and audit data.
- **Secrets:** key plaintext, provider credentials, session secrets, and database credentials.

Secrets must not be persisted inside ordinary telemetry records. Sensitive content should be minimized, redacted, access-controlled, and retained only as long as needed.

## 23.2 Data minimization

Before storing or submitting an event to a model:

- Drop unnecessary headers and request bodies.
- Redact known patterns for credentials and tokens.
- Avoid personal data in demo fixtures.
- Limit stack trace and message lengths.
- Remove query parameters known to contain secrets.
- Never collect environment variables wholesale.
- Record the redaction policy version applied.

## 23.3 AI provider disclosure

State which categories of incident evidence may be sent to the configured provider and under which provider account. Do not claim that the provider never trains on or retains data unless the provider's terms and settings actually guarantee it.

## 23.4 User controls

A future commercial release should support export of supported organization data, deletion of projects and related telemetry, integration revocation, retention settings where supported, explanation of backup deletion delays, and the ability to disable external AI or use the mock provider locally.

## 23.5 Safe public demo

Seed the public demo with synthetic data. Do not let anonymous visitors submit arbitrary logs to a shared project. Reset demo state periodically, apply quotas, and use least-privileged demo credentials. Public demo content must not contain real customer identifiers or credentials.

---

# 24. Reliability and Background Jobs

## 24.1 Queue types

Start with four queues only if their needs justify them:

- `event-correlation`
- `investigation`
- `verification`
- `retention`

Separate queues when concurrency, limits, priority, or operational ownership differs. Too many queues add overhead.

## 24.2 Job payloads

Queue payloads should contain resource IDs and minimal validated metadata:

```ts
interface InvestigationJob {
  investigationId: string;
  organizationId: string;
  incidentId: string;
  requestedAt: string;
  schemaVersion: 1;
}
```

The worker re-reads authoritative entities. A job payload is not proof of authorization or the current incident state.

## 24.3 Retry policy

Use bounded retries for transient errors, with exponential backoff and jitter where appropriate. Do not retry permanent validation errors indefinitely. Preserve sanitized error categories, not sensitive provider responses.

Examples:

- Temporary database/network issue: retry a bounded number of times.
- Provider rate limit: honor provider retry-after information when available.
- Schema validation failure: permit a limited repair/retry, then fail clearly.
- Missing/deleted resource: mark non-retryable or cancelled.
- Authorization inconsistency: stop and emit a safe operational alert.
- Verification timeout: terminate the run and persist `timed_out`.

## 24.4 Idempotency

Consider idempotency at ingestion, event persistence, incident creation, queue submission, investigation creation, verification creation, and outbox dispatch. Document each key's scope and lifetime. A key must not enable cross-organization replay.

## 24.5 Transactional outbox

Persist the business event and outbox item in one transaction. A dispatcher publishes pending rows and marks them delivered. Consumers should remain idempotent because at-least-once delivery can repeat work.

## 24.6 Cancellation

Cancellation is a request, not necessarily immediate completion. Abort an in-flight provider call where supported. Terminate a verification process only inside its isolation boundary. Persist the terminal state after the worker records it.

## 24.7 Failed and stuck jobs

For exhausted jobs, store a terminal error code/timestamp, show safe status to authorized users, log job/request IDs, support safe retry where appropriate, avoid infinite retries, and document operator recovery procedures.

## 24.8 Dependency outages

When PostgreSQL is unavailable, durable writes must fail safely. If Redis is unavailable, ingestion should use a durable outbox fallback or reject/defer work according to a clear guarantee. Never claim an event was durably accepted if neither the event nor a durable work item exists.

---

# 25. Testing and Quality Strategy

## 25.1 Testing pyramid

### Unit tests

Test pure functions and domain behavior:

- Fingerprint normalization.
- Severity mapping.
- Correlation windows.
- Incident lifecycle transitions.
- Evidence selection and ordering.
- Redaction filters.
- Schema validation.
- Evidence-reference checks.
- Verification result mapping.
- Permission policy functions.
- Idempotency-key normalization.

### Integration tests

Use real PostgreSQL for critical behavior:

- Migrations from an empty database.
- Constraints and foreign keys.
- Tenant-scoped repositories.
- RLS policies under the actual runtime role.
- Transaction rollback behavior.
- Uniqueness constraints for idempotency and incident grouping.
- Outbox persistence and dispatch.
- API-key creation, verification, and revocation.
- Worker status transitions.

### End-to-end tests

Use browser automation for the main journey:

1. Sign in or enter demo mode.
2. Open a project.
3. Trigger the seeded failure.
4. Observe the incident.
5. Open the incident workspace.
6. Run a mock or configured investigation.
7. Inspect validated evidence links.
8. Run a verification scenario.
9. See the actual result.

### Security tests

Test allowed and denied behavior, not only happy paths. Include direct-ID access, parent-resource mismatch, role escalation, revoked keys, stream access, and background jobs that contain forged or stale resource identifiers.

### Performance tests

Measure ingestion and incident-list paths using a known data set and workload. Record environment, request mix, concurrency, database size, and latency distribution. Do not publish isolated best-case numbers without methodology.

## 25.2 Two-organization isolation suite

Seed User A and User B, Organization A and Organization B, separate projects/environments, API keys, incidents, investigations, evidence records, and verification runs. Try direct-ID access, list filters, pagination cursors, SSE subscriptions, key-scope misuse, nested resource access, and background jobs referencing mismatched tenants. Every unauthorized operation must be denied.

## 25.3 AI contract tests

Include fixtures for valid output, invalid JSON, missing fields, too many hypotheses, evidence IDs not belonging to the investigation, evidence IDs from another investigation, malicious HTML/script text, overlong strings, prompt-injection text, unsupported causation claims, provider timeouts, rate limits, and unknown response properties.

## 25.4 Verification runner tests

Test a passing scenario, a test assertion failure, a startup error, timeout, cancellation, oversized output, path traversal attempts, shell metacharacters in untrusted fields, unauthorized scenario IDs, a scenario disabled after the request begins, and a worker crash before terminal-state persistence.

## 25.5 CI pipeline

For every pull request:

1. Install dependencies using the lockfile.
2. Check formatting.
3. Run lint and type checks.
4. Run unit tests.
5. Start service containers.
6. Run database migrations.
7. Run integration tests.
8. Run tenant-isolation tests.
9. Build the web, API, worker, demo, and runner images.
10. Run the critical E2E smoke test.
11. Scan dependencies and source for secrets.
12. Store useful test artifacts and safe diagnostics.

For release deployments, require the CI gates, apply reviewed migrations, deploy, run health checks, run a smoke test, and retain a rollback path.

## 25.6 Coverage policy

An initial target of 80% coverage for critical domain logic is reasonable, but coverage alone is not proof of correctness. Authorization and lifecycle rules need explicit test cases. Avoid padding overall coverage with low-value tests.

---

# 26. AI Evaluation Plan

## 26.1 Dataset

Create a version-controlled synthetic dataset containing scenario descriptions, expected relevant events, known causes or plausible candidates, contradictions/distractors, allowed evidence IDs, suitable verification scenarios, and expected limitations where the evidence is incomplete. Never commit confidential customer logs or proprietary incidents.

## 26.2 Scenario categories

1. A connection-setting change causes database connection failures.
2. A deployment introduces an exception in a specific endpoint.
3. A downstream service becomes unavailable.
4. A database query becomes slow after a controlled change.
5. An unrelated deployment occurs near an existing incident.
6. A log contains an instruction-like prompt injection.
7. Evidence is insufficient to identify one unique cause.
8. A test fails because of runner infrastructure rather than application behavior.

## 26.3 Evaluation metrics

- **Schema-valid rate:** fraction of raw outputs accepted by schema validation.
- **Citation-valid rate:** fraction of cited IDs that resolve to evidence in the exact investigation.
- **Evidence relevance:** rubric or human score for whether citations materially support each claim.
- **Top-k hypothesis recall:** fraction of known causes represented among the first `k` hypotheses.
- **Unsupported-claim rate:** fraction of material statements unsupported by supplied data.
- **Uncertainty behavior:** whether missing evidence is acknowledged rather than hidden.
- **Verification alignment:** whether a proposed check maps to an available scenario and whether the UI separates suggestion from real execution result.
- **Latency and cost:** measured per run where provider data is available.

## 26.4 Human review

Manually review a sample of outputs before making quality claims. Document the scoring rubric and examples. A small synthetic dataset demonstrates method and repeatability; it does not establish production-grade diagnosis accuracy.

## 26.5 Release gate

Do not release a feature that displays unvalidated evidence links as facts. If the provider repeatedly returns invalid structures, improve the adapter, reduce scope, or fail clearly rather than silently hiding failures.

---

# 27. Observability for SignalForge Itself

A reliability product must also be observable. Instrument the API, web server, workers, and sample service with consistent request IDs and structured logs. Use OpenTelemetry standards and semantic conventions where practical.

## 27.1 Structured log fields

Include timestamp, service name/version, environment, severity, request ID, trace/span IDs where available, job ID, operation name, duration, result/status, and sanitized error code. Include organization identifiers only where safe and operationally necessary.

Do not log complete request bodies, raw keys, cookies, or unredacted model inputs by default.

## 27.2 Metrics

Track HTTP request counts/durations/error rates, accepted/rejected ingestion counts, processing lag, queue depth and age of oldest job, job duration/retries, provider latency/errors/usage, evidence-validation failures, verification outcomes, database-pool utilization, slow queries, and rate-limit rejections.

## 27.3 Tracing

Propagate trace context through API calls, queue jobs, worker processes, provider requests, and verification processes where supported. Explicitly carry context across queue boundaries; do not assume it propagates automatically.

## 27.4 Health checks

- **Liveness:** process is alive and not irrecoverably stuck.
- **Readiness:** dependencies required for serving the request are available.
- **Worker health:** worker can poll and process jobs.
- **Integration health:** last sync/error status, not merely whether an integration row exists.

---

# 28. Deployment and Infrastructure

## 28.1 Local development

Use Docker Compose for PostgreSQL, Redis, API, worker, sample service, and verification runner. Run the Next.js app locally or in Compose, depending on the development workflow. Document exact runtime versions, environment variables, migration commands, seed commands, and tests.

## 28.2 Production-like topology

| Component | Suggested hosting pattern | Notes |
|---|---|---|
| Next.js web | Managed Next.js/Node host | Keep server secrets private |
| Fastify API | Separate long-running Node service | API and telemetry ingestion |
| Worker | Separate long-running process | Must not depend on HTTP request lifetime |
| PostgreSQL | Managed PostgreSQL | Backups and restricted access |
| Redis | Managed Redis-compatible service | Authentication, network restrictions, memory policy |
| Demo service | Isolated container/service | Synthetic data and resource limits |
| Verification runner | Isolated short-lived execution | No privileged host access |
| Object storage, if added | Private bucket | No public access by default |

Choose a hosting provider after confirming it supports the required persistent workers, network topology, container runtime, and secrets management. Do not assume a serverless function can run a persistent BullMQ worker.

## 28.3 Container standards

Use supported base images, multi-stage builds where useful, only production dependencies in final images, non-root users where practical, no `.env` files in images, intentional version pinning, health checks, and separate runner privileges. The runner must not share the API's elevated environment or secret set.

## 28.4 Migration workflow

1. Create a version-controlled migration.
2. Review locks, data loss, and rollback behavior.
3. Apply it to a disposable CI database.
4. Test application compatibility.
5. Apply to staging.
6. Verify backups according to policy.
7. Apply as a controlled production step.
8. Run smoke tests.
9. Keep a rollback or forward-fix plan.

For incompatible changes, use expand/contract: add schema first, deploy compatible code, migrate data, and remove obsolete schema only in a later release.

## 28.5 Backups and recovery

Configure automated backups and understand the provider's restore process. Perform a test restore before claiming the backup plan works. Document Redis queue behavior during outages and how pending work is recovered from PostgreSQL/outbox records.

## 28.6 Deployment and rollback

Deploy immutable builds. Keep a known-good image or commit. After release, verify readiness, run an authenticated smoke test, inspect critical API errors, and confirm jobs are processing. Roll back a material regression when schema compatibility permits.

## 28.7 Demo safety

Use a separate demo organization and synthetic records. Anonymous demo visitors should not mutate shared global state or send unbounded payloads. Apply quotas, periodic reset, and least-privileged demo credentials.

---

# 29. Environment Configuration

Provide `.env.example` with placeholders only. Never commit real credentials.

```dotenv
# Runtime
NODE_ENV=development
APP_BASE_URL=http://localhost:3000
API_BASE_URL=http://localhost:4000
LOG_LEVEL=debug

# Database
DATABASE_URL=postgresql://signalforge:signalforge_dev@localhost:5432/signalforge

# Redis
REDIS_URL=redis://localhost:6379

# Authentication / BFF
AUTH_SECRET=replace-with-a-long-random-development-secret
INTERNAL_API_SIGNING_SECRET=replace-with-a-separate-random-secret
INTERNAL_API_ISSUER=signalforge-web
INTERNAL_API_AUDIENCE=signalforge-api

# Optional AI provider; mock is suitable for local demo
AI_PROVIDER=mock
AI_API_KEY=
AI_MODEL=
AI_REQUEST_TIMEOUT_MS=30000
AI_MAX_OUTPUT_TOKENS=2000

# Data policy
TELEMETRY_RETENTION_DAYS=14
MAX_EVENT_PAYLOAD_BYTES=32768
MAX_BATCH_EVENTS=100

# Rate limits
INGEST_RATE_LIMIT_PER_MINUTE=600
INVESTIGATION_RATE_LIMIT_PER_HOUR=20

# Verification
VERIFICATION_MODE=restricted
VERIFICATION_TIMEOUT_MS=60000
VERIFICATION_MAX_OUTPUT_BYTES=65536
```

These are example names and starting values, not final production defaults. Adjust them to the implementation. Store production secrets in managed secrets configuration. Never prefix server-only secrets with `NEXT_PUBLIC_`.

## 29.1 Startup configuration validation

Validate environment variables using a runtime schema. Fail fast on missing required secrets or invalid URLs. Local mock mode should work without external AI credentials. Production must not silently fall back to fake AI unless this is a deliberate and visibly communicated behavior.

---

# 30. Development Workflow and Coding Standards

## 30.1 Definition of ready

Before implementing a feature, define the user story, permission requirements, API contract, database changes, loading/empty/error behavior, security implications, test plan, and acceptance criteria.

## 30.2 Definition of done

A feature is done only when it meets written acceptance criteria; formatter, lint, and TypeScript checks pass; normal and denied/error paths are tested; migrations are committed where needed; logs do not leak secrets; accessibility and responsive behavior are reviewed; documentation is updated; and a demo path exists.

## 30.3 TypeScript standards

Enable strict mode. Avoid `any`; use `unknown` at untrusted boundaries and validate it. Use shared runtime schemas for important API contracts. Keep domain types independent of framework request/response objects. Avoid type assertions that bypass runtime validation.

## 30.4 API standards

Validate inputs and sensitive outputs, keep handlers short, put business rules in service/domain functions, use transactions for multi-record consistency, authorize every resource boundary, return safe errors, and include request IDs in structured logs.

## 30.5 Frontend standards

Use reusable components with explicit props. Keep data access on documented server/API paths. Never place secrets in client bundles. Use accessible form/dialog primitives. Implement loading, empty, error, and retry states. Be honest about AI uncertainty and the scope of verification.

## 30.6 Database standards

Version and review migrations, constrain important relationships, paginate list queries, scope tenant access explicitly, avoid long-running transactions during model calls, and use explicit state transitions or concurrency control where races could corrupt state.

## 30.7 Git workflow

Use small focused branches and pull requests. Each PR explains the problem, solution, tests, and security implications. Keep commits scoped and require CI before merging. Never commit `.env`, sensitive logs, local database files, build output, or generated credentials.

## 30.8 Architecture Decision Records

Write short ADRs for decisions such as Fastify vs Next.js route handlers, auth strategy across BFF/API, queue/outbox design, tenant strategy, verification isolation, and the data shared with the AI provider. Each ADR should record context, options, decision, consequences, and when the decision should be reconsidered.

---

# 31. Eight- to Twelve-Week Roadmap

This roadmap assumes one developer with intermediate-to-advanced web skills working consistently. The week numbers are planning targets, not guarantees. If time is short, cut integrations and surface polish before weakening tenancy, security, or the end-to-end workflow.

## Week 1 — Product, architecture, and repository

**Objectives:** finalize the target user and demo story; create architecture/data-flow diagrams; define MVP acceptance criteria; create the monorepo; configure lint, format, TypeScript, CI, Docker Compose, PostgreSQL, Redis, and environment validation; draft the threat model and first ADRs.

**Tasks:** create landing page skeleton, API health routes, worker skeleton, database package and migration command, `.env.example`, startup validation, and synthetic seed fixture.

**Deliverable:** a repository that installs, starts, migrates, and passes basic CI.

**Exit gate:** a new developer can follow the README without undocumented setup.

## Week 2 — Identity and multi-tenancy

Implement authentication/session handling, organizations, memberships, roles, organization selection, tenant-scoped repository access, and direct-ID access-control tests.

**Deliverable:** two organizations can use one deployment without crossing data boundaries.

**Exit gate:** the authorization suite tests API access, not merely visible UI navigation.

## Week 3 — Projects, environments, deployments, and demo service

Implement project/environment/service CRUD, deployment records, the sample Node.js application, deterministic failure/recovery modes, and project-scoped API key creation/revocation.

**Deliverable:** an authorized project can generate synthetic telemetry and persist deployment metadata.

**Exit gate:** the sample app resets to a known state and produces repeatable outcomes.

## Week 4 — Ingestion pipeline

Define event schema, implement key verification, payload limits, redaction, idempotency, persistence, event list/detail APIs, worker queue, and initial outbox/dispatch mechanism. Add request IDs and structured logs.

**Deliverable:** events persist through a documented API and can be inspected.

**Exit gate:** duplicate delivery and malformed event tests behave as documented.

## Week 5 — Incident correlation

Implement normalization, fingerprinting, grouping windows, incident creation/update, deployment correlation, incident lifecycle transitions, and incident list/filter/timeline APIs.

**Deliverable:** the known sample failure produces a reproducible incident with linked events.

**Exit gate:** repeated events group correctly, environments remain separate, and cross-tenant events never merge.

## Week 6 — Evidence and AI investigation

Persist evidence packages, define provider adapter, create mock fixtures, add a configurable live provider, validate schemas and evidence IDs, handle timeouts/retries/usage metadata, and create a small synthetic evaluation set.

**Deliverable:** an investigation report shows validated hypotheses and links to stored evidence.

**Exit gate:** unknown evidence IDs and malformed provider output are never accepted.

## Week 7 — Verification engine

Define immutable scenario versions, implement the restricted runner, distinguish pass/fail/error/timeout, store structured results, cap output, handle cancellation, and test runner boundaries.

**Deliverable:** a developer runs a known scenario and inspects actual results.

**Exit gate:** no endpoint executes arbitrary user-provided shell commands.

## Week 8 — Core application UI

Build application shell, overview, incident explorer, workspace/timeline, investigation report, evidence panel, verification detail, and loading/empty/error/permission/retry states.

**Deliverable:** a user completes the main workflow in the browser.

**Exit gate:** a browser E2E test runs the seeded scenario and reaches the verification report.

## Week 9 — Live updates and integration polish

Add authorized SSE updates, deployment metadata ingestion, optional OpenTelemetry support for the sample app, filters/pagination polish, audit log UI, and API key settings.

**Deliverable:** incident and job state changes appear predictably in the app.

**Exit gate:** SSE authorization, reconnection, and minimal payload behavior are tested.

## Week 10 — Security and failure hardening

Complete the tenant-isolation matrix; review RLS and runtime roles; test rate limits and oversized payloads; test retries/terminal failures; test prompt-injection fixtures; test key rotation/revocation; review SSRF exposure; add redaction and retention behavior.

**Deliverable:** documented security test suite and threat model.

**Exit gate:** no cross-tenant test succeeds; key revocation and runner restrictions pass their tests.

## Week 11 — Deployment and documentation

Deploy web, API, worker, database, Redis, and demo service. Configure secrets and startup validation, add health/readiness checks, establish backup/recovery procedures, run migrations/smoke tests, and complete API and local-development documentation.

**Deliverable:** an accessible demo URL and reproducible repository setup.

**Exit gate:** a clean release passes health checks and the critical smoke journey.

## Week 12 — Portfolio presentation and validation

Refine accessibility/responsive behavior, seed two clear scenarios, record a two-minute walkthrough, publish architecture/threat model/AI evaluation method, publish measured performance methodology/results, interview early users, and fix the highest-priority defects.

**Deliverable:** a portfolio case study supported by a live app, public code, test results, and accurate documentation.

**Exit gate:** a reviewer can understand the problem, run the demo, inspect the code, and see how the result is verified.

## 31.1 Eight-week compression option

If the deadline is eight weeks:

- Combine weeks 1 and 2 carefully, without skipping tenant isolation.
- Combine projects/demo service with ingestion around a small sample app.
- Start with a deterministic mock AI provider, then add live AI after validation works.
- Keep only one or two verification scenarios.
- Defer GitHub integration and full direct OpenTelemetry ingestion.
- Deploy early and improve the same end-to-end flow rather than expanding scope.

Do not cut evidence validation, restricted execution, or the two-organization authorization tests.

---

# 32. MVP Acceptance Criteria

## 32.1 Product behavior

- [ ] A user can sign in or enter the synthetic demo.
- [ ] A user can create a project and environment.
- [ ] A sample application can generate a known error.
- [ ] Telemetry appears through the ingestion path.
- [ ] Incident grouping is deterministic for documented fixtures.
- [ ] The workspace shows related events and deployment context.
- [ ] An investigation can be queued and reaches a visible terminal state.
- [ ] Every accepted evidence reference resolves to a persisted record.
- [ ] AI provider failure does not corrupt the incident or hide its state.
- [ ] A verification scenario records actual outcomes.
- [ ] The UI distinguishes test failure from runner infrastructure failure.
- [ ] Demo mode works without external AI credentials and is labelled honestly.

## 32.2 Security

- [ ] Organization A cannot access Organization B's records in any tested route.
- [ ] A project key cannot ingest into another organization's project.
- [ ] Keys are shown once and not stored in plaintext.
- [ ] Revoked and expired keys are rejected.
- [ ] Rate limits apply to ingestion and investigation creation.
- [ ] Payload and output bounds are enforced.
- [ ] Log content is escaped and treated as untrusted data.
- [ ] Arbitrary shell execution is not exposed.
- [ ] Secrets do not appear in browser bundles or source control.
- [ ] Audit logs cover the documented administrative security events.

## 32.3 Engineering quality

- [ ] Clean installation works from documented commands.
- [ ] Migrations pass in CI.
- [ ] Type checks, lint, and production builds pass.
- [ ] Unit and integration tests pass.
- [ ] Tenant-isolation tests pass.
- [ ] The critical E2E flow passes.
- [ ] Retry/exhausted-job behavior is documented.
- [ ] Health checks work in the deployed environment.
- [ ] Backup/recovery strategy is documented.
- [ ] No fabricated performance, accuracy, or customer claims appear in docs.

## 32.4 Portfolio quality

- [ ] Public README includes setup and architecture.
- [ ] Architecture diagram matches the code and deployment.
- [ ] Threat model and important ADRs are published.
- [ ] Public demo contains synthetic data only.
- [ ] Demo has repeatable failure and verification scenarios.
- [ ] A short walkthrough video is available.
- [ ] AI evaluation methods and limitations are documented.
- [ ] Docs distinguish implemented features from roadmap items.

---

# 33. Release Checklist

## Code and repository

- [ ] Remove debug routes and temporary credentials.
- [ ] Search for hard-coded secrets.
- [ ] Commit lockfile and package configuration.
- [ ] Confirm no user data or production logs are in the repository.
- [ ] Tag the release and record deployed commit.

## Database

- [ ] Review migration order, locking, and destructive changes.
- [ ] Verify indexes for important queries.
- [ ] Verify foreign keys and tenant consistency.
- [ ] Confirm runtime database-role privileges.
- [ ] Test RLS using the runtime role if RLS is enabled.
- [ ] Confirm backup and retention policies.

## API and workers

- [ ] Health/readiness endpoints behave correctly.
- [ ] Invalid requests return safe error envelopes.
- [ ] Rate-limit behavior is documented.
- [ ] Job failures reach visible terminal states.
- [ ] No route trusts client organization IDs without authorization.
- [ ] API and provider secrets are redacted from logs.

## Web interface

- [ ] Test keyboard and focus behavior.
- [ ] Test narrow-screen layout.
- [ ] Check form labels and chart accessibility.
- [ ] Check empty, loading, error, and permission states.
- [ ] Label simulated demo output where applicable.
- [ ] Verify sign-out and expired-session behavior.

## Operations

- [ ] Production secrets are configured securely.
- [ ] Services can access only required dependencies.
- [ ] Backup policy is active.
- [ ] Error monitoring is enabled.
- [ ] Smoke tests pass after deployment.
- [ ] Rollback/forward-fix procedure is documented.

---

# 34. Portfolio and Case-Study Strategy

## 34.1 Reviewer experience

A reviewer should quickly understand the value proposition and verify that the application is real. The ideal sequence is:

1. Read the product promise.
2. Launch the demo without difficult setup.
3. Trigger a known failure.
4. Watch the incident appear.
5. Inspect evidence and the AI hypothesis.
6. Run the verification scenario.
7. Review source code and tests.
8. Read architecture and security decisions.

## 34.2 Public README outline

1. Product title and value proposition.
2. Screenshots and demo video.
3. Key features and supported workflows.
4. Architecture diagram.
5. Technology stack.
6. Local requirements.
7. Quickstart commands.
8. Environment setup.
9. Migration and seed commands.
10. Test commands.
11. How to start the sample failure.
12. Optional AI provider configuration.
13. Security model and threat model.
14. Limitations/non-goals.
15. AI evaluation methodology.
16. Deployment overview.
17. Roadmap/contribution guide.
18. License.

## 34.3 Documentation deliverables

- `README.md`: introduction and quickstart.
- `docs/architecture.md`: components, flows, trust boundaries.
- `docs/database.md`: ERD and migration notes.
- `docs/api.md`: authentication, contracts, errors.
- `docs/threat-model.md`: assets, threats, controls, residual risk.
- `docs/operations.md`: deployment, health, backup, recovery, job failures.
- `docs/user-guide.md`: UI and demo usage.
- `docs/ai-evaluation.md`: synthetic data, rubric, limitations.
- `docs/decisions/`: architecture decision records.

## 34.4 Two-minute video script

**0:00–0:15 — Problem.** “SignalForge connects application failures to telemetry and deployment context, then helps developers investigate and verify the fix.”

**0:15–0:35 — Trigger failure.** Click the seeded failure and show the event and incident creation.

**0:35–0:55 — Inspect evidence.** Show the timeline and related deployment. Explain that correlation is not proof of causation.

**0:55–1:20 — Investigation.** Show evidence links and limitations. If using mock AI, label it as a deterministic demo result.

**1:20–1:40 — Verification.** Run the predefined scenario and show assertions/results.

**1:40–2:00 — Engineering depth.** Show architecture, tenant-isolation tests, API contract, and repository.

## 34.5 CV bullet

After genuinely implementing and testing the product, a suitable bullet is:

> Designed and built SignalForge, a multi-tenant reliability platform using Next.js, TypeScript, Node.js, and PostgreSQL, with evidence-grounded AI investigations, deterministic incident correlation, controlled verification runs, background processing, and automated authorization tests.

Replace general statements with measured results only after collecting them. Performance figures should include workload and environment.

## 34.6 Landing-page copy

**Headline:** Investigate the failure. Prove the fix.

**Subheadline:** SignalForge connects application errors, logs, traces, and deployment history to produce evidence-backed investigations and controlled verification reports.

**Primary CTA:** Run the live demo  
**Secondary CTA:** Explore the architecture

**Trust statement:** AI-generated hypotheses are validated against stored evidence. Verification status is derived from test execution, not from the model's own claim.

Publish the trust statement only after these behaviors are implemented and tested.

---

# 35. Startup Validation and Commercial Direction

## 35.1 Three outcomes

- **Employment:** Demonstrate full-stack engineering, backend architecture, security, testing, and AI integration.
- **Freelancing:** Demonstrate the ability to ship a maintainable product with real workflows and documentation.
- **Startup exploration:** Test whether a focused reliability workflow solves an urgent problem for a specific group.

These outcomes share an engineering foundation but require different evidence. Do not delay the portfolio release while attempting to solve pricing, enterprise integrations, sales, and product-market fit.

## 35.2 Initial customer segment

Start with independent developers and small SaaS teams running Node.js applications. A narrow segment keeps setup and demo scenarios predictable.

## 35.3 Discovery plan

1. Interview five to ten target users.
2. Show a working synthetic scenario.
3. Ask users to narrate their normal debugging workflow.
4. Observe where SignalForge helps or confuses them.
5. Ask what evidence they trust and what data they refuse to send to an AI provider.
6. Ask whether they would test it on a non-critical service or sanitized incident.
7. Record objections, not only positive feedback.
8. Update priorities based on observed pain, not feature requests alone.

## 35.4 Monetization hypotheses

Potential plans may be based on project count, telemetry volume, retention, monthly investigations, team members, integrations, or private/self-hosted deployment in a future release. Do not set final pricing until model and storage costs, support burden, usage patterns, and willingness to pay have been measured.

A free tier or public demo should have quotas, reset behavior, and abuse protection.

## 35.5 Early signals

Potentially useful signals include users completing the demo without guidance, repeating it on a second incident, inspecting evidence rather than only the summary, running verification, inviting teammates, requesting specific integrations, or testing on a non-critical service. Positive comments alone are weak evidence; repeated use and specific behavior are more informative.

---

# 36. Risks and Trade-Offs

| Risk | Why it matters | Mitigation |
|---|---|---|
| Scope creep | Integrations can prevent the core workflow from shipping | Lock P0 scope; defer optional features |
| Incorrect AI diagnosis | Fluent explanations can mislead users | Evidence validation, uncertainty labels, raw sources, human review |
| Competitor overlap | Generic AI debugging is not unique | Focus on reproducibility and verification workflow |
| Telemetry cost | Storage and model submissions can grow | Bounds, quotas, retention, relevance filtering, cost metrics |
| Tenant isolation defect | Cross-customer exposure can be severe | Composite constraints, RLS where appropriate, negative tests |
| Runner compromise | Code execution can expose secrets/host | Built-in scenarios, isolation, least privilege, no arbitrary command endpoint |
| Lost queue work | Persisted events may never be correlated | Transactional outbox or documented durable handoff |
| Unconvincing demo | Random data undermines trust | Deterministic scenarios and actual persisted runs |
| Hosting mismatch | Host may not support persistent worker or private network | Verify capabilities before selecting host |
| Identity complexity | Web session and API auth may diverge | Choose one trust model early and document it |
| RLS misconfiguration | Privileged roles/context errors can bypass policy | Runtime role, transaction-scoped context, tests for pool reuse |
| Model cost | Excessive contexts cause high costs | Bounded context, quotas, mock mode, controlled model settings |
| Timeline overrun | UI-first development creates rework | Build vertical slices early |
| Unsupported marketing | “First,” “100% accurate,” “enterprise-grade” claims are hard to prove | State verified capabilities and limitations only |

## 36.1 Deliberate trade-offs

- PostgreSQL-only telemetry is simple initially but may not suit very high volume.
- A queue improves responsiveness but adds asynchronous state and retry complexity.
- Mock AI makes the demo reproducible but must never masquerade as a live model.
- RLS adds defense in depth but requires disciplined context and role design.
- A restricted runner is safer than arbitrary execution but limits user flexibility.
- Supporting only Node.js makes the MVP achievable but limits immediate compatibility.

These are acceptable MVP trade-offs if they are documented and tested.

---

# 37. Implementation Prompts for an AI Coding Assistant

Use these as sequential task briefs for an AI coding assistant. Do not ask it to generate the whole platform in one uncontrolled pass. Review diffs, execute tests, and distinguish implemented behavior from suggestions.

## Prompt 1 — Repository audit and setup

```text
Act as a senior full-stack engineer. We are building SignalForge, a developer reliability platform using Next.js, TypeScript, Node.js/Fastify, PostgreSQL, Drizzle, Redis, and BullMQ.

Before editing:
1. Inspect the repository and report the actual stack/state.
2. Identify broken configuration, duplicate dependencies, missing scripts, and architecture risks.
3. Do not delete working code without explaining why.
4. Propose the smallest changes needed for a strict-TypeScript monorepo.

Implement only the foundation: workspace configuration, shared tooling config, app skeletons for web/API/worker/demo-service, Docker Compose for PostgreSQL/Redis, environment validation, health endpoints, and CI checks.

Requirements: strict TypeScript; no secrets in browser code/source control; .env.example contains placeholders only; reproducible local startup; tests for environment validation and health endpoints; README contains exact commands. Run applicable checks and report actual commands/results. Do not claim tests passed unless they were executed.
```

## Prompt 2 — Database and tenant identity

```text
Implement the SignalForge identity and multi-tenant foundation.

Review the existing schema and auth approach first. Preserve sound existing work. Implement users, organizations, memberships, projects, environments, services, migrations, roles (owner/admin/member/viewer), shared authorization logic, server-side session validation, and a documented web-to-API trust model. Organization creation and initial-owner assignment must be transactional. Prevent removal of the last owner.

Every tenant-owned query must be scoped by organization and parent resource. Never trust organization IDs or roles from the browser. If PostgreSQL RLS is used, configure the runtime role and test missing tenant context and pooled-connection reuse. Add positive and negative tests plus docs. Run checks and report real results.
```

## Prompt 3 — Telemetry ingestion

```text
Implement SignalForge telemetry ingestion for the Node.js sample service.

Requirements: project-scoped high-entropy API keys with scopes/expiry/revocation and hashed storage; POST /v1/ingest/events with runtime validation; body/message/attribute/batch limits; timestamp bounds; service/environment ownership validation; known-secret redaction; idempotent retries; PostgreSQL persistence and indexes; transactional outbox or an equivalent documented reliable queue handoff; no logging secrets or complete sensitive payloads.

Add tests for malformed input, revoked keys, rate limits, cross-project identifiers, retries, and duplicates. Keep normalization/domain rules outside the HTTP handler. Update OpenAPI and setup docs. Run tests and report actual output.
```

## Prompt 4 — Incident correlation

```text
Implement the deterministic SignalForge incident engine.

Support stable fingerprints from normalized bounded fields; grouping by organization/project/environment/time window; transactional incident create/update; event count and first/last-seen times; valid lifecycle transitions; deployment correlation as a temporal relation rather than proof of causation; idempotent processing under repeated delivery; and grouping-rule versioning where useful.

Add deterministic fixtures for repeated events, environment separation, tenant separation, late-arriving events, and retries. Keep AI out of this layer. Include unit and real-PostgreSQL integration tests. Document algorithm assumptions and limits.
```

## Prompt 5 — AI investigation

```text
Implement the SignalForge AI investigation pipeline using a provider adapter and deterministic mock provider.

Create investigation records and bounded jobs. Gather and persist relevant evidence before provider calls. Limit count/size; redact secrets; treat log/commit text as untrusted. Require structured JSON, validate schema/lengths/allowed fields/evidence IDs, and reject IDs from other investigations/tenants. Store provider/model/prompt version and usage metadata where available. Use timeouts, bounded retries, and visible terminal failures. No model tool execution, commands, production changes, or verification-status authority. Label mock output honestly.

Test malformed JSON, unknown evidence IDs, prompt injection, overlong output, timeout, rate limit, and valid output. Add a synthetic evaluation set and document what it can and cannot demonstrate. Never invent accuracy claims.
```

## Prompt 6 — Restricted verification runner

```text
Implement the SignalForge runner for built-in test scenarios only.

No public arbitrary shell-command endpoint. A scenario key maps to a fixed server-approved executable/arguments. Never interpolate untrusted strings into a shell. Run in an isolated container/process with time, memory, output, and network limits; use non-root execution where possible; do not mount the Docker socket or inject production secrets. Validate scenario ownership, enabled status, and immutable version. Persist queued/running/passed/failed/error/timed_out/cancelled. Status derives only from runner output; sanitize output.

Test passing, assertion failure, startup error, timeout, cancellation, unauthorized scenarios, output overflow, and malicious metadata. Document limitations and trust boundaries.
```

## Prompt 7 — Frontend workflow

```text
Build SignalForge UI in the existing Next.js/TypeScript app.

Pages: overview, project/environment selection, incident explorer with filters/pagination, incident workspace with timeline/deployments/logs/traces/evidence, investigation report with hypotheses and limitations, verification detail with actual assertions, project key settings, and organization membership settings.

Use a professional dark-first developer-tool design, restrained blue/teal accents, readable typography, accessible focus, meaningful tables, and compact charts. Avoid decorative effects that reduce clarity. Implement loading, empty, no-results, permission, validation, rate-limit, job-running, and terminal-failure states. Never label mock AI as live AI or temporal correlation as certain causation. Add responsive behavior and Playwright coverage for the end-to-end demo.
```

## Prompt 8 — Security review

```text
Review SignalForge as a multi-tenant SaaS that stores telemetry and uses AI.

Inspect every route for object-level authorization; organization/project scope in repositories and background jobs; RLS/runtime roles if enabled; API key lifecycle; validation, payload sizes, rate limiting, pagination, idempotency; cookies/CSRF/CORS/CSP; prompt injection and redaction; SSRF in integrations; runner isolation and arbitrary-code paths; audit logs, error disclosure, sensitive output; dependencies and secrets.

Do not claim a formal audit or certification. Produce prioritized findings with file paths, exploit preconditions, impact, and fixes. Remediate critical/high-confidence issues and add regression tests. Run checks and separate verified results from issues needing manual review.
```

## Prompt 9 — Deployment and operations

```text
Prepare SignalForge for a production-like portfolio deployment.

Separate web, API, worker, demo service, PostgreSQL, and Redis responsibilities. Configure managed secrets, environment validation, health/readiness, controlled migrations, bounded retries, visible worker failures, structured redacted logs, backup/recovery docs, hardened Docker builds, CI checks, post-deployment smoke tests, rollback strategy, synthetic demo data, and quotas.

Verify the chosen host supports persistent workers, private networking, and container execution. Do not assume a serverless function can run a persistent BullMQ worker. Document actual configuration, checks, limits, and evidence. Do not claim checks passed without running them.
```

## Prompt 10 — Final portfolio review

```text
Review SignalForge as a technical portfolio project for senior developers, hiring managers, and potential clients. Do not add features solely to make it look larger.

Verify that the seeded incident flow works; investigation uses persisted evidence; evidence IDs are checked; verification derives from execution; tenant-isolation tests cover API and worker paths; public demo is synthetic and safe; README and architecture match the actual code/deployment; performance measurements include methodology; AI evaluation claims match the dataset; known limitations are documented.

Fix high-impact defects, improve onboarding and documentation, and prepare a two-minute demo script. Report changes, test commands/results, remaining risks, and which features are complete versus planned.
```

---

# 38. Recommended Build Order

Build vertical slices rather than finishing every schema, screen, and integration in isolation.

## Slice 1: Runnable local system

Repository, database, Redis, API health endpoint, worker, sample service, and CI.

## Slice 2: Secure tenant boundary

Identity, membership, project creation, authorization policy, and direct-ID isolation tests.

## Slice 3: Actual event path

Generate sample event → authenticate project key → validate/persist event → query it in the UI.

## Slice 4: Deterministic incident

Persist repeated events → compute fingerprint → create/update incident → show timeline.

## Slice 5: Evidence-backed investigation

Create investigation → gather/persist evidence → run mock provider → validate citations → show report.

## Slice 6: Verification result

Run built-in scenario → capture assertions → persist result → show pass/fail/error distinction.

## Slice 7: Complete browser demo

A reviewer can trigger, inspect, investigate, verify, and review the result without manually editing the database.

## Slice 8: Hardening

Negative authorization tests, rate limits, queue recovery, redaction, safe rendering, retention, and operational checks.

## Slice 9: Real provider/integration

Add a live AI adapter and selected integration only after the mock path and validation system are stable.

## Slice 10: Public release

Deploy, seed synthetic demo data, record a walkthrough, complete documentation, and validate with potential users.

**Build principle:** Every slice should leave the repository runnable. Do not postpone integration until the final week.

---

# 39. Glossary

- **API key:** A secret used by a machine client to authenticate to a scoped API.
- **Audit log:** A record of a security- or administration-relevant action.
- **BFF (Backend for Frontend):** A server-side layer that provides a safe interface between a particular frontend and backend services.
- **Correlation:** A relationship based on evidence such as time, trace ID, service, deployment, or fingerprint. Correlation alone does not establish causation.
- **Distributed trace:** Representation of a request's path through one or more services, commonly made of spans.
- **Evidence item:** A persisted record or extracted fact used by an investigation and traceable to a source.
- **Fingerprint:** A normalized identifier used to group similar telemetry events.
- **Hypothesis:** A possible explanation requiring evidence and potentially verification.
- **Idempotency:** Repeating an operation with the same documented key does not create unintended additional effects.
- **Incident:** A grouped record for related errors or unhealthy behavior.
- **OpenTelemetry:** A vendor-neutral observability framework for instrumentation, collection, and export.
- **RLS (Row-Level Security):** PostgreSQL functionality for restricting which rows a role can read or modify.
- **SSE (Server-Sent Events):** A browser-compatible way to stream one-way server-to-client updates over HTTP.
- **Tenant isolation:** Ensuring each organization can access only the data/actions it is authorized to use.
- **Telemetry:** Runtime data such as logs, metrics, traces, and events.
- **Transactional outbox:** A pattern that persists a business change and a message-to-publish in one transaction; a dispatcher publishes the message reliably.
- **Verification run:** A recorded execution of a predefined scenario with results, status, timing, and version metadata.

---

# 40. References and Further Reading

The following are entry points to official or primary documentation. Recheck versions, capabilities, and provider terms before implementation or marketing claims.

## Competitor and product context

- Sentry Seer: <https://docs.sentry.io/product/ai-in-sentry/seer/>
- Datadog: <https://www.datadoghq.com/>
- Datadog documentation: <https://docs.datadoghq.com/>
- incident.io: <https://incident.io/>

## Architecture and frameworks

- Next.js documentation: <https://nextjs.org/docs>
- Fastify documentation: <https://fastify.dev/docs/latest/>
- Drizzle ORM: <https://orm.drizzle.team/docs/overview>
- Zod: <https://zod.dev/>
- PostgreSQL: <https://www.postgresql.org/docs/current/>
- PostgreSQL Row Security Policies: <https://www.postgresql.org/docs/current/ddl-rowsecurity.html>
- BullMQ retries: <https://docs.bullmq.io/guide/retrying-failing-jobs>
- BullMQ rate limiting: <https://docs.bullmq.io/guide/rate-limiting>

## Observability

- OpenTelemetry documentation: <https://opentelemetry.io/docs/>
- OpenTelemetry concepts: <https://opentelemetry.io/docs/concepts/>
- OpenTelemetry signals: <https://opentelemetry.io/docs/concepts/signals/>

## Security

- OWASP API Security Top 10: <https://owasp.org/API-Security/editions/2023/en/>
- OWASP Top 10: <https://owasp.org/www-project-top-ten/>
- OWASP Cheat Sheet Series: <https://cheatsheetseries.owasp.org/>

## Project documentation to maintain

- Architecture diagram and trust boundaries.
- Database ERD and migration notes.
- OpenAPI specification.
- Threat model.
- AI evaluation report.
- Verification runner security notes.
- Deployment/recovery runbook.
- Architecture decision records.

---

# Final Recommendation

Build SignalForge as a small but complete reliability product. Keep the first version focused on a Node.js sample service, a PostgreSQL-backed event pipeline, deterministic incident grouping, evidence-grounded AI investigations, and a restricted verification runner.

The strongest portfolio story is not “I built a dashboard with AI.” It is:

> “I designed and shipped a multi-tenant system that turns a reproducible software failure into a traceable investigation, validates every AI evidence reference, and records whether a controlled test actually passed.”

The difference will be visible in the working demo, schema and authorization tests, operational design, and honest documentation. Make claims no bigger than the implementation—and make the implementation easy for another engineer to inspect and reproduce.
