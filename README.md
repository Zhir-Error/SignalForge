# SignalForge

**Investigate the failure. Prove the fix.** SignalForge is a developer reliability platform that connects application telemetry with deployments and incidents, preserves investigation evidence, and records the result of a registered verification check.

The repository contains a working local product workflow and a sample checkout service. The default AI provider is a deterministic mock, so local setup does not require an external AI account. See [implementation status](docs/IMPLEMENTATION_STATUS.md) for verified behavior, known gaps, and the latest verification record. SignalForge has not been deployed to an external production environment.

## Product workflow

1. Create an account and workspace. Onboarding creates an organization, project, staging environment, demo service, registered verification scenarios, and a project ingestion key.
2. Generate a labelled synthetic checkout failure in the workspace or send bounded telemetry using a project key. The API validates and redacts the event, persists it, deduplicates retries, and writes a durable outbox record in the same transaction.
3. The worker groups related events into incidents and persists investigation evidence before calling the configured provider.
4. The worker validates provider output and evidence references before saving investigation hypotheses.
5. Run an allowlisted verification scenario and inspect the assertions returned by its actual execution.

## Technology and architecture

- **Web:** Next.js App Router, React, TypeScript, and Tailwind CSS
- **API and identity:** Fastify and Better Auth email/password sessions
- **Data:** PostgreSQL, Drizzle ORM, migrations, row-level security, and a transactional outbox
- **Jobs:** PostgreSQL outbox polling, with Redis and BullMQ as an optional delivery transport
- **Shared code:** TypeScript domain rules and Zod contracts, with an OpenAPI specification
- **Sample service:** Instrumented checkout API using OpenTelemetry
- **Verification:** Fixed scenario keys routed to a restricted verification runner

```mermaid
flowchart LR
  Browser --> Web[Next.js web app]
  Browser -->|session cookie and REST| API[Fastify API]
  API --> Auth[Better Auth]
  API --> DB[(Tenant PostgreSQL)]
  API -->|business row and outbox in one transaction| Outbox[(PostgreSQL outbox)]
  Outbox --> Worker[Background worker]
  Worker <-->|optional queue transport| Redis[(Redis / BullMQ)]
  Worker -->|persist evidence and results| DB
  Worker -->|optional structured analysis| AI[OpenAI Responses API]
  Worker --> Runner[Verification runner]
  Runner --> Demo[Sample checkout service]
  Demo --> DemoDB[(Separate demo PostgreSQL)]
```

PostgreSQL remains the durable source for pending work whether Redis is enabled or not. The verification runner accepts registered scenario keys; it does not accept user shell commands or customer code. The demo checkout uses a separate database from tenant data.

## Repository layout

| Path                       | Purpose                                                                    |
| -------------------------- | -------------------------------------------------------------------------- |
| `apps/web`                 | Next.js landing page and workspace UI                                      |
| `apps/api`                 | Fastify HTTP API, authentication integration, and telemetry ingestion      |
| `apps/worker`              | Incident correlation, investigations, verification dispatch, and retention |
| `apps/demo-service`        | Instrumented sample checkout service and demo database checks              |
| `apps/verification-runner` | Authenticated runner for fixed verification scenarios                      |
| `packages/auth`            | Shared authentication helpers                                              |
| `packages/contracts`       | Shared request, response, and event schemas                                |
| `packages/db`              | Database schema, client, and SQL migrations                                |
| `packages/domain`          | Shared domain rules and validation                                         |
| `packages/ai-investigator` | Mock and OpenAI investigation providers                                    |
| `infra/postgres`           | PostgreSQL runtime-role initialization script                              |
| `docs`                     | Deployment, testing, threat model, architecture, and status notes          |
| `tests`, `e2e`             | Vitest unit/integration tests and Playwright browser workflow              |
| `scripts`                  | Migration and end-to-end workflow helper scripts                           |

## Prerequisites

- **Node.js 20.9 or newer.** Node.js 24 is the version used for current workspace verification.
- **pnpm 11.20.0.** The repository pins this version in `package.json` through Corepack.
- **Docker Desktop with Docker Compose**, for the recommended local database and Redis setup.
- **PowerShell**, for the documented Windows commands and the migration verification script.

If you are not using Docker, install PostgreSQL 18 locally. Redis 7 is optional: without Redis, the worker consumes jobs directly from the PostgreSQL outbox.

Enable the pinned package manager and install the locked dependencies:

```powershell
corepack enable
corepack prepare pnpm@11.20.0 --activate
pnpm --version
pnpm install --frozen-lockfile
```

The reported pnpm version should be `11.20.0`.

## Local development setup

The recommended setup runs PostgreSQL and Redis in Docker and runs the five application processes through pnpm.

### 1. Create the local environment file

From the repository root:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

If `.env` already exists, keep it and update only the values you need.

Generate two separate secrets. Paste the first output into `AUTH_SECRET` and the second into `VERIFICATION_RUNNER_SECRET` in `.env`:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Keep `.env` local; it is ignored by Git. The example file contains development connection strings and placeholders, not production credentials.

### 2. Start the data services

Make sure Docker Desktop is running, then start the tenant database, separate demo database, and Redis:

```powershell
docker compose up -d postgres demo-postgres redis
docker compose ps
```

Wait until the three services report healthy. On first startup, the tenant database initialization script creates the restricted `signalforge_app` runtime role. The API and worker use this role through `DATABASE_URL`; schema changes use the owner credential in `MIGRATION_DATABASE_URL`.

### 3. Apply database migrations

```powershell
pnpm db:migrate
```

Run this command after a fresh database setup and whenever new migrations are added. `pnpm db:generate` creates a migration from schema changes; review the generated SQL before applying it.

### 4. Start the application

```powershell
pnpm dev
```

This starts the web app, API, worker, sample checkout service, and verification runner in parallel. Leave the terminal open while using the app. For independent terminals, use `pnpm dev:web`, `pnpm dev:api`, `pnpm dev:worker`, `pnpm dev:demo`, and `pnpm dev:runner` after the data services and migrations are ready.

### 5. Open the app and complete the demo

- Web app: <http://localhost:3000>
- Workspace and sign-in: <http://localhost:3000/app>
- API liveness: <http://localhost:4000/health>
- API readiness (includes a database check): <http://localhost:4000/ready>
- Sample checkout health: <http://localhost:4100/health>
- Sample checkout: <http://localhost:4100/checkout>
- Verification runner health: <http://localhost:4200/health>

Open `/app`, create an account and workspace, and use the workspace's synthetic failure action to exercise ingestion, correlation, investigation, and verification. Store the project key shown during onboarding securely; it is returned once.

The sample checkout returns a database recovery result. To also send its simulated database failure through the normal telemetry API, set `DEMO_API_KEY` in `.env` to a project ingestion key and restart the demo service. The demo service uses `DEMO_DATABASE_URL`, which is separate from the tenant database.

### Optional: run the app services in Docker

The Compose app images provide a convenient containerized development stack. Start dependencies and apply migrations first, then build and start the app services:

```powershell
docker compose up -d postgres demo-postgres redis
docker compose run --rm migrate
docker compose up --build -d api worker demo-service verification-runner web
```

Inspect container status and logs with:

```powershell
docker compose ps
docker compose logs -f api worker demo-service verification-runner web
```

Stop containers and keep their database volumes with `docker compose down`. To reset local database and Redis data as well, use `docker compose down --volumes`; this deletes the Compose volumes.

The current Dockerfile includes workspace source and development dependencies. The Compose configuration is for local development and verification, not a production deployment recipe. Review [deployment notes](docs/DEPLOYMENT.md) before preparing an external deployment.

## Environment variables

`.env.example` lists the local variables used by the workspace. Keep service URLs and credentials consistent with the selected setup.

| Variable                             | Purpose                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`                           | Runtime mode; local development uses `development`.                                                                            |
| `APP_BASE_URL`                       | Browser-facing web origin used by the API/auth configuration.                                                                  |
| `API_BASE_URL`                       | API origin used by web and demo-service requests.                                                                              |
| `DATABASE_URL`                       | PostgreSQL URL for API and worker runtime access; use the restricted `signalforge_app` role.                                   |
| `MIGRATION_DATABASE_URL`             | PostgreSQL owner URL used by Drizzle migrations.                                                                               |
| `DEMO_DATABASE_URL`                  | URL for the sample checkout's separate PostgreSQL database.                                                                    |
| `REDIS_URL`                          | Optional Redis connection. If unset, the worker uses PostgreSQL outbox polling.                                                |
| `AUTH_SECRET`                        | Secret used for authentication/session signing; use a random value of at least 32 characters.                                  |
| `VERIFICATION_RUNNER_SECRET`         | Shared secret for worker-to-runner and runner-to-demo-service requests; use a separate random value of at least 32 characters. |
| `AI_PROVIDER`                        | `mock` (default, deterministic) or `openai`.                                                                                   |
| `AI_API_KEY`                         | Provider key required when `AI_PROVIDER=openai`. Keep it server-side.                                                          |
| `AI_MODEL`                           | OpenAI model identifier required when `AI_PROVIDER=openai`.                                                                    |
| `AI_REQUEST_TIMEOUT_MS`              | Worker timeout for an AI provider request; defaults to 30 seconds.                                                             |
| `LOG_LEVEL`                          | Log verbosity (`fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent` for the API).                                   |
| `TRUSTED_PROXY_IPS`                  | Comma-separated trusted proxy IPs when running behind a proxy; leave blank for direct local access.                            |
| `TELEMETRY_RETENTION_DAYS`           | Global telemetry and completed investigation evidence retention period; defaults to 14 days.                                   |
| `MAX_EVENT_PAYLOAD_BYTES`            | Maximum accepted telemetry event payload size; defaults to 32 KiB.                                                             |
| `MAX_BATCH_EVENTS`                   | Maximum events in one ingestion batch; defaults to 100.                                                                        |
| `INGEST_RATE_LIMIT_PER_MINUTE`       | Per-client-IP telemetry ingestion limit; defaults to 600 requests per minute.                                                  |
| `INVESTIGATION_RATE_LIMIT_PER_HOUR`  | Per-client-IP investigation request limit; defaults to 20 per hour.                                                            |
| `VERIFICATION_TIMEOUT_MS`            | Verification execution timeout; defaults to 60 seconds.                                                                        |
| `VERIFICATION_MAX_OUTPUT_BYTES`      | Maximum verification result size; defaults to 64 KiB.                                                                          |
| `VERIFICATION_RUNNER_URL`            | Worker URL for the verification runner; local default is `http://127.0.0.1:4200`.                                              |
| `DEMO_SERVICE_URL`                   | Runner URL for the sample checkout; local default is `http://127.0.0.1:4100`.                                                  |
| `DEMO_API_KEY`                       | Optional project key that lets the sample checkout submit failure telemetry to the API.                                        |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | Optional OTLP traces export endpoint for the instrumented sample service.                                                      |

Compose also accepts optional host-port overrides: `POSTGRES_HOST_PORT` (default `5432`), `DEMO_POSTGRES_HOST_PORT` (default `5433`), and `REDIS_HOST_PORT` (default `6379`). Use these when the default ports are already occupied.

Optional process settings include `DEMO_SERVICE_PORT` (default `4100`), `VERIFICATION_RUNNER_PORT` (default `4200`), `VERIFICATION_RUNNER_HOST` (defaults to loopback in local development), and `PLAYWRIGHT_BASE_URL` (default `http://localhost:3000`). The standard local setup does not need these overrides.

### Using local PostgreSQL and Redis instead of Docker

Create the `signalforge` and `signalforge_demo` databases, then configure their connection URLs in `.env`. The example URLs expect the local development roles shown here. Run these statements as a PostgreSQL administrator, for example in a `psql -U postgres` session:

```sql
CREATE ROLE signalforge_owner LOGIN CREATEDB PASSWORD 'signalforge_owner_dev';
CREATE DATABASE signalforge OWNER signalforge_owner;
CREATE ROLE signalforge_demo LOGIN PASSWORD 'signalforge_demo_dev';
CREATE DATABASE signalforge_demo OWNER signalforge_demo;
```

Connect to the tenant database as `signalforge_owner` and create the restricted runtime role before applying migrations:

```powershell
psql "postgresql://signalforge_owner:signalforge_owner_dev@127.0.0.1:5432/signalforge" -v ON_ERROR_STOP=1 -f .\infra\postgres\init\01-runtime-role.sql
pnpm db:migrate
```

The migration verification command needs the owner role's `CREATEDB` permission to create a temporary database. Change the example credentials to match your local PostgreSQL users. Do not rerun the role script on a database where `signalforge_app` already exists without adapting it. Redis is optional; remove or comment out `REDIS_URL` to use the PostgreSQL outbox fallback.

## Commands

Run commands from the repository root.

| Command                     | Description                                                                |
| --------------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`                  | Start web, API, worker, demo service, and verification runner.             |
| `pnpm dev:web`              | Start only the Next.js web app.                                            |
| `pnpm dev:api`              | Start only the Fastify API.                                                |
| `pnpm dev:worker`           | Start only the background worker.                                          |
| `pnpm dev:demo`             | Start only the sample checkout service.                                    |
| `pnpm dev:runner`           | Start only the verification runner.                                        |
| `pnpm build`                | Build all workspace packages and applications.                             |
| `pnpm typecheck`            | Type-check all workspace packages and applications.                        |
| `pnpm lint`                 | Run ESLint across the repository.                                          |
| `pnpm format:check`         | Check formatting with Prettier.                                            |
| `pnpm format`               | Format repository files with Prettier.                                     |
| `pnpm test`                 | Run Vitest unit and configured integration tests.                          |
| `pnpm test:integration`     | Run the tenant-isolation PostgreSQL integration test.                      |
| `pnpm test:watch`           | Run Vitest in watch mode.                                                  |
| `pnpm e2e`                  | Run the Playwright Chromium workflow; Playwright starts the app processes. |
| `pnpm smoke:workflow`       | Run the end-to-end workflow script against already-running local services. |
| `pnpm db:generate`          | Generate a Drizzle migration from schema changes.                          |
| `pnpm db:migrate`           | Apply pending migrations using the migration database URL.                 |
| `pnpm db:verify-migrations` | Apply migrations to a temporary database and verify runtime-role access.   |

## Tests and verification

Run formatting, lint, type checks, unit tests, dependency audits, build, and migration checks with:

```powershell
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm audit
pnpm audit --prod
pnpm build
pnpm db:verify-migrations
```

The PostgreSQL tenant-isolation integration test runs when `DATABASE_URL` points to a migrated database using the restricted runtime role; otherwise Vitest skips that integration test. The migration verification script creates and removes its own uniquely named temporary database and requires owner-level permissions to do so.

For the complete browser workflow, make sure the databases are running and migrated, then install Chromium and run E2E:

```powershell
pnpm exec playwright install chromium
pnpm e2e
```

Playwright starts the application processes itself. Keep ports 3000 and 4000–4200 free; configure working local database URLs and secrets in `.env` first. The workflow creates synthetic records in the configured databases. For the service-level workflow smoke, start `pnpm dev` in one terminal and run `pnpm smoke:workflow` in a second terminal.

See [testing and verification](docs/TESTING.md) for test coverage and the latest recorded results. The recorded local checks do not imply that hosted CI or a production environment has been verified.

## Operational behavior and current limits

- `AI_PROVIDER=mock` is the default and produces deterministic simulated investigations. Live OpenAI analysis requires `AI_PROVIDER=openai`, `AI_API_KEY`, and `AI_MODEL`; no automatic fallback to mock occurs when live provider configuration is incomplete.
- Invitation links can be generated, but the project has no configured email delivery provider. Password reset/account recovery is not enabled.
- Telemetry retention is configured globally. Audit records are retained until organization deletion.
- Ingestion and investigation rate limits currently use process-local storage keyed by client IP. Configure a shared store before running multiple API replicas.
- Verification is limited to allowlisted scenarios. The local Compose runner has container restrictions, but this does not establish production-grade isolation or prove that an external production system was repaired.
- The project has not been deployed externally. Production image hardening, host-specific isolation, backups and restore drills, monitoring, and rollback procedures remain deployment work.

## Troubleshooting

- **API fails to start:** Check that `DATABASE_URL` points to the tenant database, `AUTH_SECRET` has at least 32 characters, and the `signalforge_app` role exists. Apply migrations with `pnpm db:migrate` using the owner URL.
- **`/ready` returns an error:** Check the tenant PostgreSQL container with `docker compose ps` and confirm the database host port and URL match.
- **Port is already in use:** Change the Compose host ports with `POSTGRES_HOST_PORT`, `DEMO_POSTGRES_HOST_PORT`, or `REDIS_HOST_PORT`. Application ports are 3000, 4000, 4100, and 4200.
- **Verification remains queued:** Confirm that the worker and runner are running and that `VERIFICATION_RUNNER_URL` and `VERIFICATION_RUNNER_SECRET` match across the worker, runner, and demo service configuration.
- **Checkout recovery reports a database error:** Check `DEMO_DATABASE_URL`; the checkout service uses its own database and does not read tenant data.
- **Redis is unavailable:** Remove `REDIS_URL` and restart the worker to use PostgreSQL outbox polling. Pending jobs remain durable in PostgreSQL.
- **Docker Compose does not pick up a changed secret:** Recreate the affected containers after updating `.env`. Do not paste secrets into source files or commit `.env`.

## Project documentation

- [OpenAPI contract](docs/openapi.yaml)
- [Testing and verification](docs/TESTING.md)
- [Deployment and operations](docs/DEPLOYMENT.md)
- [Threat model](docs/THREAT_MODEL.md)
- [Architecture decisions](docs/ARCHITECTURE_DECISIONS.md)
- [AI evaluation plan](docs/AI_EVALUATION.md)
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Product and engineering plan](SignalForge_Complete_Product_and_Engineering_Plan.md)
