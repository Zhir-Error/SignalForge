# Deployment and operations

The repository includes a local Docker Compose stack with a separate PostgreSQL database for the sample checkout. App runtime images build from the locked workspace and deploy the selected package's production dependency graph and compiled runtime artifacts; the migration profile uses the full builder stage. App containers run with `NODE_ENV=production` as the non-root `node` user. Compose gives the verification runner a read-only root filesystem, bounded `/tmp`, dropped capabilities, no-new-privileges, CPU/memory/process limits, and an internal network shared with the worker and sample service. This is not a production deployment recipe: production-host isolation and configuration still need independent setup and review.

## Local containers

Set distinct random `AUTH_SECRET` and `VERIFICATION_RUNNER_SECRET` values in `.env`. Start data dependencies, apply the migration release step, then start app services:

```powershell
docker compose up -d postgres redis demo-postgres
docker compose run --rm migrate
docker compose up --build -d api worker demo-service verification-runner web
```

If a `.env` value contains `$`, wrap it in single quotes so Compose treats it literally. The published database and Redis ports default to `5432`, `5433`, and `6379`; override them with `POSTGRES_HOST_PORT`, `DEMO_POSTGRES_HOST_PORT`, and `REDIS_HOST_PORT` when those ports are already in use.

The Postgres service initializes the restricted `signalforge_app` role on a new volume. Migrations use `MIGRATION_DATABASE_URL`; API and worker processes use `DATABASE_URL`. PostgreSQL 18 stores its volume at `/var/lib/postgresql`. The Compose setup persists PostgreSQL and Redis data in named volumes.

## Production prerequisites

Before a production deployment, select the hosting platform and complete the following work for that target:

- The five application images built locally. Runtime probes passed for API liveness/readiness, demo-service health, the web routes and auth rewrite, and the registered recovery scenario through the isolated runner. The final images omit workspace source, `.env`, and `.git` and run as UID 1000. The API and worker package trees still include unused optional Better Auth peers such as Next.js and test tooling, so dependency trimming and smaller runtime images remain release work. Inspect images before release and keep provider and runner secrets out of the web image.
- Place PostgreSQL, Redis, API, worker, and web in private network segments. Expose only the web/API ingress needed by users and telemetry senders.
- Apply migrations as a one-shot release job using the owner credential; application services should use the restricted runtime role.
- Keep the verification runner and sample service on a private network. The runner calls one authenticated registered-scenario endpoint and accepts no shell commands. The local Compose stack limits and isolates the runner; apply equivalent CPU, memory, filesystem, execution-time, and network restrictions to the production runner and sample service. Do not mount the Docker socket or application secrets into either service.
- Configure TLS, a trusted proxy allowlist, cookie settings, rate limits, log redaction, and secret rotation. `TRUSTED_PROXY_IPS` must reflect the actual proxy chain.
- The API-key, organization, and Fastify/IP request limits, including the investigation limit, use Redis when `REDIS_URL` is configured; local Compose supplies Redis. Without Redis they fall back to process-local stores for development. Redis errors fail closed because rate-limit storage skips no errors. Configure shared Redis before horizontally scaling API replicas and monitor Redis availability.
- Provide email delivery before presenting invitations as emailed. Invitation creation currently returns a link for manual delivery.
- Password reset is disabled until a trusted email delivery provider and reset-link handling are configured. Better Auth does not return reset tokens to callers.
- Set `AI_PROVIDER=openai`, `AI_API_KEY`, and `AI_MODEL` only when live investigation is intended. The mock provider is the default and remains explicitly labelled.
- Configure PostgreSQL backups, point-in-time recovery as available, and a scheduled restore drill. No backup restore has been performed in this workspace.

## Health, queues, and retention

- `GET /health` is a process liveness endpoint. `GET /ready` checks PostgreSQL and returns 503 if it is unavailable.
- With `REDIS_URL`, the worker publishes and consumes jobs through BullMQ. Without it, the PostgreSQL outbox poller is used. Both modes completed the local workflow smoke. A local Docker run also verified poison-job exhaustion and delivery of a durable job after Redis restarted; broader production outage and failover behavior still needs testing.
- The sample checkout uses a separate `DEMO_DATABASE_URL`. Its registered recovery scenario executes `SELECT 1` and returns the database's actual response; the sample service has no access to the tenant application database.
- Outbox rows remain the durable source for pending work. In Redis mode, a job's topic, payload, and tenant must match its claimed PostgreSQL outbox row before execution or retry-exhaustion handling; an identical duplicate for a delivered row is acknowledged without reprocessing. An outbox row is acknowledged only after the BullMQ processor succeeds. Queue dispatch failures return the row to `pending` with capped exponential backoff without consuming processor retries. Periodic lease reconciliation checks BullMQ state and requeues missing jobs; the PostgreSQL fallback heartbeats active work and reclaims stale leases. Local Compose checks exercised the Redis/BullMQ happy path, exhausted-job terminal state, and delivery recovery after Redis restarted; broader outages and production failover remain unverified.
- `TELEMETRY_RETENTION_DAYS` defaults to 14 days. The worker deletes old telemetry and completed investigation evidence in bounded batches. Audit records are not included in this cleanup and remain until organization deletion. Retention is a global environment setting, not an organization-level product setting.
- The SSE project stream sends incident snapshots; clients also poll as a fallback.

No external environment has been provisioned or deployed. Host-specific ingress, secrets, backup/restore, rollback, monitoring, and service sizing remain to be determined. There is no provider-specific backup/restore runbook or completed restore drill; do not treat the development volume configuration as a backup strategy.
