# Testing and verification

Run the checks from the workspace root:

```powershell
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm audit
pnpm audit --prod
pnpm build
pnpm db:verify-migrations
pnpm smoke:workflow
pnpm exec playwright install chromium
pnpm e2e
```

## Test layers

- **Vitest unit tests** cover shared contracts, incident domain rules, redaction, citation validation, verification outcome classification, demo database URL validation, registered-runner behavior, bounded runner responses, AI-provider error mapping and token-usage validation, and worker outbox authorization against forged, missing, stale, and duplicate jobs.
- **PostgreSQL integration tests** verify the restricted runtime role, missing tenant context, pooled-connection reuse, and cross-organization project isolation; API-key scope, expiry, and revocation; cross-project ingestion rejection; idempotent event replay; correlation replay, late events, reopen, environment and organization boundaries; outbox lease reconciliation through a mocked BullMQ inspector, dispatch-deferral state transition, and telemetry retention. They run when `DATABASE_URL` points to a migrated database using the restricted `signalforge_app` role.
- **Fresh migration verification** (`pnpm db:verify-migrations`) creates a uniquely named temporary database, applies all migrations, checks restricted-role access, then drops only that generated database.
- **OpenAPI contract test** parses `docs/openapi.yaml` and checks central workflow paths.
- **Workflow smoke test** (`pnpm smoke:workflow`) creates a disposable account/workspace and checks incident correlation, mock investigation/evidence, and the sample service's database recovery scenario. It requires the API, worker, runner, demo service, application PostgreSQL, and a reachable `DEMO_DATABASE_URL`; start services with `pnpm dev` first. It leaves synthetic records in the database. The smoke was run in PostgreSQL fallback mode and in the Docker Compose Redis/BullMQ mode.
- **Playwright browser workflow** checks the public landing page, unauthenticated live-stream rejection, signup, workspace creation, last-owner demotion/removal protection, environment/service/deployment management, API-key creation and revocation, malformed telemetry rejection, ingestion idempotency and conflict handling, ingestion and investigation rate-limit responses, HTML/script log payload rendering as text, invitation acceptance as a viewer, viewer read-only controls, audit review, incident correlation, mock investigation, and recovery. It also creates an independent second account and verifies that cross-tenant project, incident, investigation, evidence, verification, audit, membership, and invitation reads are denied or return empty tenant-filtered collections; resource writes and key revocation are denied. It starts an isolated dev server with lower rate limits to exercise 429 responses. Recovery asserts `200 CHECKOUT_READY` after the sample service runs a real PostgreSQL `SELECT 1`. Keep ports 3000 and 4000–4200 free; both databases and valid local secrets must be ready.
- **GitHub Actions** provisions PostgreSQL and Chromium, audits production dependencies, migrates a fresh database, and runs formatting, lint, type, Vitest, build, and browser checks. Hosted GitHub Actions have not been run for this workspace.

Docker Compose, PostgreSQL 18, and Redis 7 were available for the final local run. The Compose validation used a separate project and host ports `55433`, `55434`, and `16379` because the default ports were already occupied. The five Node service images built successfully, default to the non-root `node` user, and the Compose smoke completed through Redis/BullMQ. The PostgreSQL outbox fallback and stale-lease recovery were also exercised. In a second isolated run, a poison job reached `failed:JOB_RETRIES_EXHAUSTED`; after Redis was stopped, a valid durable job stayed `processing` and reached `delivered` after Redis restarted. The isolated application PostgreSQL cluster used for the workspace tests listens on port 55432. The sample checkout uses a separate demo database and cannot read tenant data; its recovery scenario verifies that demo database only.

## Current verification record

On 2026-10-27, `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test` (45 tests across 11 files), `pnpm audit`, `pnpm audit --prod`, `pnpm build`, `pnpm db:migrate`, `pnpm db:verify-migrations`, `pnpm smoke:workflow`, and `pnpm e2e` passed. Tests include restricted-role PostgreSQL checks for RLS, pooled-connection context reset, API keys, ingestion idempotency, correlation boundaries, outbox recovery, and retention; six focused worker outbox authorization checks; and synthetic AI evaluation fixture validation. The browser journey also verified last-owner protection, rate-limit responses, untrusted log rendering, unauthenticated stream/runner rejection, key revocation, telemetry idempotency, viewer permissions, a two-account cross-tenant route matrix, incident correlation, mock investigation, controlled failure, and recovery verification. Docker validation additionally passed a complete five-image build earlier in the run, a rebuilt worker image after the outbox authorization change, isolated Compose startup, migration application, non-root identity checks, and the Redis/BullMQ workflow smoke. See `IMPLEMENTATION_STATUS.md` for the per-command evidence and environment limitations.

The production build emits a warning that the Next.js plugin is not detected by the framework's build-time lint integration; the standalone `pnpm lint` check passes. The Docker images still include source files and development dependencies. Compose configures a read-only runner root, bounded no-exec `/tmp`, 128 MiB/0.5 CPU/64-PID limits, dropped capabilities, no-new-privileges, and an internal network. Docker inspection confirmed the effective resource, filesystem, capability, and network settings; write and external-egress probes were blocked while the registered recovery workflow passed. Equivalent production-host enforcement has not been tested. A live OpenAI request, hosted GitHub Actions, and external deployment were not run.
