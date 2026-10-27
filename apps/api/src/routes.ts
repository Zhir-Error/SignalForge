import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, gte, isNull, lt, or, sql } from "drizzle-orm";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  apiKeyInputSchema,
  cursorPageSchema,
  deploymentInputSchema,
  environmentInputSchema,
  incidentSeveritySchema,
  incidentStatusInputSchema,
  incidentStatusSchema,
  invitationAcceptSchema,
  invitationInputSchema,
  investigationRequestSchema,
  membershipRoleSchema,
  membershipUpdateSchema,
  onboardingInputSchema,
  organizationInputSchema,
  projectInputSchema,
  projectUpdateSchema,
  serviceInputSchema,
  verificationRequestSchema,
} from "@signalforge/contracts";
import {
  canTransitionIncident,
  fingerprintEvent,
  redactText,
  requireIncidentTransition,
} from "@signalforge/domain";
import {
  apiKeys,
  auditLogs,
  deployments,
  environments,
  evidenceItems,
  hypotheses,
  hypothesisEvidence,
  incidentEvents,
  incidents,
  investigations,
  memberships,
  organizationInvitations,
  organizations,
  outbox,
  projects,
  services,
  telemetryEvents,
  testScenarios,
  users,
  verificationRuns,
} from "@signalforge/db";
import {
  ApiError,
  organizationHeader,
  requireActor,
  requireMember,
  requireRole,
  type DatabaseHandle,
} from "./security.js";
import { createProjectKey, authenticateProjectKey } from "./key-auth.js";
import { config } from "./config.js";
import { ingestTelemetry } from "./ingestion.js";
import {
  cancelQueuedInvestigation,
  retryFailedInvestigation,
} from "./investigations.js";
import type { IngestionRateLimiter } from "./ingestion-rate-limit.js";
import {
  decodeCursor,
  encodeCursor,
  incidentCursorSchema,
  incidentEventCursorSchema,
  InvalidCursorError,
} from "./pagination.js";
import type { SignalForgeAuth } from "@signalforge/auth";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Dependencies = {
  database: DatabaseHandle;
  auth: SignalForgeAuth;
  ingestionRateLimiter: IngestionRateLimiter;
};
type ProjectParams = { projectId: string };
type IncidentParams = { incidentId: string };
type InvestigationParams = { investigationId: string };
type VerificationParams = { runId: string };
type OrganizationParams = { organizationId: string };
type MemberParams = { organizationId: string; userId: string };
type InvitationParams = { organizationId: string; invitationId: string };

function requireUuid(value: string): string {
  if (!uuid.test(value))
    throw new ApiError(
      404,
      "RESOURCE_NOT_FOUND",
      "The requested resource was not found.",
    );
  return value;
}

function success<T>(request: FastifyRequest, data: T) {
  return { data, requestId: request.id };
}

function parseBody<T>(
  schema: {
    safeParse(input: unknown): { success: true; data: T } | { success: false };
  },
  body: unknown,
): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      "The request body contains invalid fields.",
    );
  return result.data;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug || "signalforge";
}

async function audit(
  database: DatabaseHandle,
  userId: string,
  organizationId: string,
  requestId: string,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await database.withTenant(userId, organizationId, async (tx) => {
    await tx.insert(auditLogs).values({
      organizationId,
      actorUserId: userId,
      action,
      resourceType,
      resourceId,
      requestId,
      outcome: "success",
      metadata,
    });
  });
}

async function projectContext(
  request: FastifyRequest,
  deps: Dependencies,
  projectIdValue: string,
  minimumRole: "viewer" | "member" | "admin" | "owner" = "viewer",
) {
  const projectId = requireUuid(projectIdValue);
  const organizationId = organizationHeader(request);
  const member = await requireMember(
    request,
    deps.auth,
    deps.database,
    organizationId,
  );
  requireRole(member, minimumRole);
  const [project] = await deps.database.withTenant(
    member.actor.userId,
    organizationId,
    (tx) =>
      tx
        .select({
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
          organizationId: projects.organizationId,
        })
        .from(projects)
        .where(
          and(
            eq(projects.id, projectId),
            eq(projects.organizationId, organizationId),
          ),
        )
        .limit(1),
  );
  if (!project)
    throw new ApiError(
      404,
      "RESOURCE_NOT_FOUND",
      "The requested resource was not found.",
    );
  return { member, project };
}

export async function registerRoutes(
  app: FastifyInstance,
  dependencies: Dependencies,
): Promise<void> {
  const { database, auth } = dependencies;

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError)
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    if (error instanceof Error && "validation" in error && error.validation)
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "The request contains invalid fields.",
          requestId: request.id,
        },
      });
    const errorCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;
    request.log.error(
      {
        code: "REQUEST_FAILED",
        errorName: error instanceof Error ? error.name : typeof error,
        errorCode,
      },
      "API request failed",
    );
    return reply.code(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "The request could not be completed.",
        requestId: request.id,
      },
    });
  });

  app.get("/health", async (request) => ({
    data: { status: "ok", service: "signalforge-api" },
    requestId: request.id,
  }));
  app.get("/ready", async (request, reply) => {
    try {
      await database.health();
      return {
        data: { status: "ready", database: "available" },
        requestId: request.id,
      };
    } catch {
      return reply.code(503).send({
        error: {
          code: "NOT_READY",
          message: "A required dependency is unavailable.",
          requestId: request.id,
        },
      });
    }
  });

  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    url: "/api/auth/*",
    async handler(request, reply) {
      try {
        const url = new URL(
          request.raw.url ?? request.url,
          config.API_BASE_URL,
        );
        const headers = fromNodeHeaders(request.headers);
        headers.set("x-signalforge-client-ip", request.ip);
        const body =
          request.body === undefined ? undefined : JSON.stringify(request.body);
        const authRequest = new Request(url, {
          method: request.method,
          headers,
          ...(body === undefined ? {} : { body }),
        });
        const response = await auth.handler(authRequest);
        reply.code(response.status);
        response.headers.forEach((value, key) => reply.header(key, value));
        return reply.send(Buffer.from(await response.arrayBuffer()));
      } catch {
        request.log.error(
          { code: "AUTH_HANDLER_FAILED" },
          "Authentication request failed",
        );
        return reply.code(500).send({
          error: {
            code: "AUTH_FAILURE",
            message: "The authentication request could not be completed.",
            requestId: request.id,
          },
        });
      }
    },
  });

  app.get("/v1/me", async (request) =>
    success(request, await requireActor(request, auth)),
  );
  app.get("/v1/me/organizations", async (request) => {
    const actor = await requireActor(request, auth);
    const rows = await database.db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        role: memberships.role,
      })
      .from(memberships)
      .innerJoin(
        organizations,
        eq(organizations.id, memberships.organizationId),
      )
      .where(eq(memberships.userId, actor.userId))
      .orderBy(asc(organizations.name));
    return success(request, rows);
  });

  app.post("/v1/organizations", async (request, reply) => {
    const actor = await requireActor(request, auth);
    const input = parseBody(organizationInputSchema, request.body);
    const organizationSlug = `${slugify(input.name)}-${randomBytes(3).toString("hex")}`;
    const [organization] = await database.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(organizations)
        .values({ name: input.name, slug: organizationSlug })
        .returning({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
        });
      if (!created) throw new Error("ORGANIZATION_CREATE_FAILED");
      await tx.insert(memberships).values({
        organizationId: created.id,
        userId: actor.userId,
        role: "owner",
      });
      await tx.execute(
        sql`select set_config('app.user_id', ${actor.userId}, true), set_config('app.organization_id', ${created.id}, true)`,
      );
      await tx.insert(auditLogs).values({
        organizationId: created.id,
        actorUserId: actor.userId,
        action: "organization.created",
        resourceType: "organization",
        resourceId: created.id,
        requestId: request.id,
      });
      return [created];
    });
    return reply.code(201).send({ data: organization, requestId: request.id });
  });

  app.get<{ Params: OrganizationParams }>(
    "/v1/organizations/:organizationId/members",
    async (request) => {
      const organizationId = requireUuid(request.params.organizationId);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "member");
      const rows = await database.db
        .select({
          userId: memberships.userId,
          email: users.email,
          name: users.name,
          role: memberships.role,
          joinedAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(eq(memberships.organizationId, organizationId))
        .orderBy(asc(users.name));
      return success(request, rows);
    },
  );

  app.get<{ Params: OrganizationParams }>(
    "/v1/organizations/:organizationId/invitations",
    async (request) => {
      const organizationId = requireUuid(request.params.organizationId);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "admin");
      const rows = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .select({
              id: organizationInvitations.id,
              email: organizationInvitations.email,
              role: organizationInvitations.role,
              expiresAt: organizationInvitations.expiresAt,
              acceptedAt: organizationInvitations.acceptedAt,
              revokedAt: organizationInvitations.revokedAt,
              createdAt: organizationInvitations.createdAt,
            })
            .from(organizationInvitations)
            .where(eq(organizationInvitations.organizationId, organizationId))
            .orderBy(desc(organizationInvitations.createdAt))
            .limit(100),
      );
      return success(request, rows);
    },
  );

  app.post<{ Params: OrganizationParams }>(
    "/v1/organizations/:organizationId/invitations",
    async (request, reply) => {
      const organizationId = requireUuid(request.params.organizationId);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "admin");
      const input = parseBody(invitationInputSchema, request.body);
      if (input.role === "admin" && member.role !== "owner")
        throw new ApiError(
          403,
          "FORBIDDEN",
          "Only an owner can invite an organization admin.",
        );
      const [existingMember] = await database.db
        .select({ id: users.id })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(sql`lower(${users.email})`, input.email),
          ),
        )
        .limit(1);
      if (existingMember)
        throw new ApiError(
          409,
          "ALREADY_A_MEMBER",
          "This user already belongs to the organization.",
        );
      await database.withTenant(member.actor.userId, organizationId, (tx) =>
        tx
          .update(organizationInvitations)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(organizationInvitations.organizationId, organizationId),
              eq(organizationInvitations.email, input.email),
              isNull(organizationInvitations.acceptedAt),
              isNull(organizationInvitations.revokedAt),
              lt(organizationInvitations.expiresAt, new Date()),
            ),
          ),
      );
      const [existingInvitation] = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .select({ id: organizationInvitations.id })
            .from(organizationInvitations)
            .where(
              and(
                eq(organizationInvitations.organizationId, organizationId),
                eq(organizationInvitations.email, input.email),
                isNull(organizationInvitations.acceptedAt),
                isNull(organizationInvitations.revokedAt),
                gte(organizationInvitations.expiresAt, new Date()),
              ),
            )
            .limit(1),
      );
      if (existingInvitation)
        throw new ApiError(
          409,
          "INVITATION_PENDING",
          "A current invitation already exists for this email address.",
        );
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      let invitation:
        | { id: string; email: string; role: string; expiresAt: Date }
        | undefined;
      try {
        [invitation] = await database.withTenant(
          member.actor.userId,
          organizationId,
          (tx) =>
            tx
              .insert(organizationInvitations)
              .values({
                organizationId,
                email: input.email,
                role: input.role,
                tokenHash,
                expiresAt,
                createdBy: member.actor.userId,
              })
              .returning({
                id: organizationInvitations.id,
                email: organizationInvitations.email,
                role: organizationInvitations.role,
                expiresAt: organizationInvitations.expiresAt,
              }),
        );
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ApiError(
            409,
            "INVITATION_PENDING",
            "A current invitation already exists for this email address.",
          );
        throw error;
      }
      if (!invitation) throw new Error("INVITATION_CREATE_FAILED");
      await audit(
        database,
        member.actor.userId,
        organizationId,
        request.id,
        "organization.invitation_created",
        "invitation",
        invitation.id,
        { email: invitation.email, role: invitation.role },
      );
      return reply.code(201).send({
        data: { ...invitation, token, delivery: "manual" },
        requestId: request.id,
      });
    },
  );

  app.delete<{ Params: InvitationParams }>(
    "/v1/organizations/:organizationId/invitations/:invitationId",
    async (request) => {
      const organizationId = requireUuid(request.params.organizationId);
      const invitationId = requireUuid(request.params.invitationId);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "admin");
      const [revoked] = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .update(organizationInvitations)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(organizationInvitations.id, invitationId),
                eq(organizationInvitations.organizationId, organizationId),
                isNull(organizationInvitations.acceptedAt),
                isNull(organizationInvitations.revokedAt),
              ),
            )
            .returning({ id: organizationInvitations.id }),
      );
      if (!revoked)
        throw new ApiError(
          404,
          "RESOURCE_NOT_FOUND",
          "The requested invitation was not found.",
        );
      await audit(
        database,
        member.actor.userId,
        organizationId,
        request.id,
        "organization.invitation_revoked",
        "invitation",
        revoked.id,
      );
      return success(request, { revoked: true });
    },
  );

  app.post("/v1/invitations/accept", async (request) => {
    const actor = await requireActor(request, auth);
    const input = parseBody(invitationAcceptSchema, request.body);
    const tokenHash = createHash("sha256").update(input.token).digest("hex");
    const client = await database.pool.connect();
    let candidate:
      | {
          id: string;
          organization_id: string;
          email: string;
          role: string;
          expires_at: Date;
          accepted_at: Date | null;
          revoked_at: Date | null;
        }
      | undefined;
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.invitation_lookup', 'on', true)",
      );
      const result = await client.query<{
        id: string;
        organization_id: string;
        email: string;
        role: string;
        expires_at: Date;
        accepted_at: Date | null;
        revoked_at: Date | null;
      }>(
        "SELECT id, organization_id, email, role, expires_at, accepted_at, revoked_at FROM organization_invitations WHERE token_hash = $1 LIMIT 1",
        [tokenHash],
      );
      candidate = result.rows[0];
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    if (
      !candidate ||
      candidate.revoked_at ||
      candidate.accepted_at ||
      candidate.expires_at <= new Date() ||
      candidate.email.toLowerCase() !== actor.email.toLowerCase()
    )
      throw new ApiError(
        404,
        "INVITATION_NOT_FOUND",
        "This invitation is invalid, expired, or belongs to another email address.",
      );
    const result = await database.withTenant(
      actor.userId,
      candidate.organization_id,
      async (tx) => {
        const [invitation] = await tx
          .select()
          .from(organizationInvitations)
          .where(
            and(
              eq(organizationInvitations.id, candidate.id),
              eq(organizationInvitations.tokenHash, tokenHash),
              eq(
                organizationInvitations.organizationId,
                candidate.organization_id,
              ),
            ),
          )
          .for("update")
          .limit(1);
        if (
          !invitation ||
          invitation.acceptedAt ||
          invitation.revokedAt ||
          invitation.expiresAt <= new Date() ||
          invitation.email.toLowerCase() !== actor.email.toLowerCase()
        )
          throw new ApiError(
            404,
            "INVITATION_NOT_FOUND",
            "This invitation is invalid, expired, or belongs to another email address.",
          );
        const [existing] = await tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, candidate.organization_id),
              eq(memberships.userId, actor.userId),
            ),
          )
          .limit(1);
        if (existing)
          throw new ApiError(
            409,
            "ALREADY_A_MEMBER",
            "You already belong to this organization.",
          );
        await tx.insert(memberships).values({
          organizationId: candidate.organization_id,
          userId: actor.userId,
          role: membershipRoleSchema.parse(invitation.role),
        });
        await tx
          .update(organizationInvitations)
          .set({ acceptedAt: new Date() })
          .where(eq(organizationInvitations.id, invitation.id));
        await tx.insert(auditLogs).values({
          organizationId: candidate.organization_id,
          actorUserId: actor.userId,
          action: "organization.invitation_accepted",
          resourceType: "invitation",
          resourceId: invitation.id,
          requestId: request.id,
        });
        return {
          organizationId: candidate.organization_id,
          role: invitation.role,
        };
      },
    );
    return success(request, result);
  });

  app.patch<{ Params: MemberParams }>(
    "/v1/organizations/:organizationId/members/:userId",
    async (request) => {
      const organizationId = requireUuid(request.params.organizationId);
      const targetUserId = request.params.userId;
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "admin");
      const input = parseBody(membershipUpdateSchema, request.body);
      const result = await database.withTenant(
        member.actor.userId,
        organizationId,
        async (tx) => {
          const [lockedOrganization] = await tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .for("update");
          if (!lockedOrganization)
            throw new ApiError(
              404,
              "RESOURCE_NOT_FOUND",
              "The requested organization was not found.",
            );
          const [target] = await tx
            .select({ role: memberships.role })
            .from(memberships)
            .where(
              and(
                eq(memberships.organizationId, organizationId),
                eq(memberships.userId, targetUserId),
              ),
            )
            .for("update")
            .limit(1);
          if (!target)
            throw new ApiError(
              404,
              "RESOURCE_NOT_FOUND",
              "The requested member was not found.",
            );
          if (
            (target.role === "owner" || input.role === "owner") &&
            member.role !== "owner"
          )
            throw new ApiError(
              403,
              "FORBIDDEN",
              "Only an owner can change an owner role.",
            );
          if (target.role === "owner" && input.role !== "owner") {
            const owners = await tx
              .select({ userId: memberships.userId })
              .from(memberships)
              .where(
                and(
                  eq(memberships.organizationId, organizationId),
                  eq(memberships.role, "owner"),
                ),
              );
            if (owners.length <= 1)
              throw new ApiError(
                409,
                "LAST_OWNER",
                "An organization must retain at least one owner.",
              );
          }
          const [updated] = await tx
            .update(memberships)
            .set({ role: input.role, updatedAt: new Date() })
            .where(
              and(
                eq(memberships.organizationId, organizationId),
                eq(memberships.userId, targetUserId),
              ),
            )
            .returning({ userId: memberships.userId, role: memberships.role });
          if (!updated)
            throw new ApiError(
              404,
              "RESOURCE_NOT_FOUND",
              "The requested member was not found.",
            );
          return { updated, previousRole: target.role };
        },
      );
      await audit(
        database,
        member.actor.userId,
        organizationId,
        request.id,
        "organization.member_role_changed",
        "membership",
        targetUserId,
        { from: result.previousRole, to: input.role },
      );
      return success(request, result.updated);
    },
  );

  app.delete<{ Params: MemberParams }>(
    "/v1/organizations/:organizationId/members/:userId",
    async (request) => {
      const organizationId = requireUuid(request.params.organizationId);
      const targetUserId = request.params.userId;
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "admin");
      await database.withTenant(
        member.actor.userId,
        organizationId,
        async (tx) => {
          const [lockedOrganization] = await tx
            .select({ id: organizations.id })
            .from(organizations)
            .where(eq(organizations.id, organizationId))
            .for("update");
          if (!lockedOrganization)
            throw new ApiError(
              404,
              "RESOURCE_NOT_FOUND",
              "The requested organization was not found.",
            );
          const [target] = await tx
            .select({ role: memberships.role })
            .from(memberships)
            .where(
              and(
                eq(memberships.organizationId, organizationId),
                eq(memberships.userId, targetUserId),
              ),
            )
            .for("update")
            .limit(1);
          if (!target)
            throw new ApiError(
              404,
              "RESOURCE_NOT_FOUND",
              "The requested member was not found.",
            );
          if (target.role === "owner" && member.role !== "owner")
            throw new ApiError(
              403,
              "FORBIDDEN",
              "Only an owner can remove an owner.",
            );
          if (target.role === "owner") {
            const owners = await tx
              .select({ userId: memberships.userId })
              .from(memberships)
              .where(
                and(
                  eq(memberships.organizationId, organizationId),
                  eq(memberships.role, "owner"),
                ),
              );
            if (owners.length <= 1)
              throw new ApiError(
                409,
                "LAST_OWNER",
                "An organization must retain at least one owner.",
              );
          }
          const [removed] = await tx
            .delete(memberships)
            .where(
              and(
                eq(memberships.organizationId, organizationId),
                eq(memberships.userId, targetUserId),
              ),
            )
            .returning({ userId: memberships.userId });
          if (!removed)
            throw new ApiError(
              404,
              "RESOURCE_NOT_FOUND",
              "The requested member was not found.",
            );
        },
      );
      await audit(
        database,
        member.actor.userId,
        organizationId,
        request.id,
        "organization.member_removed",
        "membership",
        targetUserId,
      );
      return success(request, { removed: true });
    },
  );

  app.post("/v1/onboarding", async (request, reply) => {
    const actor = await requireActor(request, auth);
    const input = parseBody(onboardingInputSchema, request.body);
    const organizationId = randomUUID();
    const organizationSlug = `${slugify(input.organizationName)}-${randomBytes(3).toString("hex")}`;
    const key = createProjectKey();
    const created = await database.db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({
          id: organizationId,
          name: input.organizationName,
          slug: organizationSlug,
        })
        .returning({
          id: organizations.id,
          name: organizations.name,
          slug: organizations.slug,
        });
      if (!organization) throw new Error("ORGANIZATION_CREATE_FAILED");
      await tx
        .insert(memberships)
        .values({ organizationId, userId: actor.userId, role: "owner" });
      await tx.execute(
        sql`select set_config('app.user_id', ${actor.userId}, true), set_config('app.organization_id', ${organizationId}, true)`,
      );
      const [project] = await tx
        .insert(projects)
        .values({
          organizationId,
          name: input.projectName,
          slug: input.projectSlug,
          createdBy: actor.userId,
        })
        .returning({
          id: projects.id,
          name: projects.name,
          slug: projects.slug,
        });
      if (!project) throw new Error("PROJECT_CREATE_FAILED");
      const [environment] = await tx
        .insert(environments)
        .values({
          organizationId,
          projectId: project.id,
          name: "Staging",
          slug: "staging",
        })
        .returning({
          id: environments.id,
          name: environments.name,
          slug: environments.slug,
        });
      if (!environment) throw new Error("ENVIRONMENT_CREATE_FAILED");
      const [service] = await tx
        .insert(services)
        .values({
          organizationId,
          projectId: project.id,
          name: "Checkout API",
          serviceKey: "checkout-api",
          description: "Synthetic SignalForge demo service",
        })
        .returning({
          id: services.id,
          name: services.name,
          serviceKey: services.serviceKey,
        });
      if (!service) throw new Error("SERVICE_CREATE_FAILED");
      await tx.insert(testScenarios).values([
        {
          organizationId,
          projectId: project.id,
          name: "Reproduce known failure",
          scenarioKey: "known-failure",
          description:
            "Checks the registered broken checkout configuration in the isolated demo.",
          scenarioVersion: "1",
        },
        {
          organizationId,
          projectId: project.id,
          name: "Recovery check",
          scenarioKey: "recovery-check",
          description:
            "Checks the registered corrected checkout configuration in the isolated demo.",
          scenarioVersion: "1",
        },
      ]);
      await tx.insert(apiKeys).values({
        organizationId,
        projectId: project.id,
        name: "Initial ingestion key",
        keyPrefix: key.prefix,
        keyHash: key.hash,
        scopes: ["events:write"],
        createdBy: actor.userId,
      });
      await tx.insert(auditLogs).values({
        organizationId,
        actorUserId: actor.userId,
        action: "organization.onboarded",
        resourceType: "project",
        resourceId: project.id,
        requestId: request.id,
        metadata: { projectSlug: project.slug },
      });
      return { organization, project, environment, service };
    });
    return reply.code(201).send({
      data: { ...created, ingestionKey: key.plaintext, keyShownOnce: true },
      requestId: request.id,
    });
  });

  app.get<{ Querystring: { organizationId?: string } }>(
    "/v1/projects",
    async (request) => {
      const organizationId = request.query.organizationId;
      if (!organizationId)
        throw new ApiError(
          400,
          "ORGANIZATION_REQUIRED",
          "Provide an organizationId query parameter.",
        );
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      const rows = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .select()
            .from(projects)
            .where(eq(projects.organizationId, organizationId))
            .orderBy(asc(projects.name)),
      );
      return success(request, rows);
    },
  );

  app.post("/v1/projects", async (request, reply) => {
    const organizationId = organizationHeader(request);
    const member = await requireMember(request, auth, database, organizationId);
    requireRole(member, "admin");
    const input = parseBody(projectInputSchema, request.body);
    try {
      const created = await database.withTenant(
        member.actor.userId,
        organizationId,
        async (tx) => {
          const [project] = await tx
            .insert(projects)
            .values({
              organizationId,
              name: input.name,
              slug: input.slug,
              description: input.description ?? null,
              createdBy: member.actor.userId,
            })
            .returning();
          if (!project) throw new Error("PROJECT_CREATE_FAILED");
          await tx.insert(environments).values({
            organizationId,
            projectId: project.id,
            name: "Staging",
            slug: "staging",
          });
          await tx.insert(services).values({
            organizationId,
            projectId: project.id,
            name: "Checkout API",
            serviceKey: "checkout-api",
            description: "Synthetic SignalForge demo service",
          });
          await tx.insert(testScenarios).values([
            {
              organizationId,
              projectId: project.id,
              name: "Reproduce known failure",
              scenarioKey: "known-failure",
              description:
                "Checks the registered broken checkout configuration in the isolated demo.",
              scenarioVersion: "1",
            },
            {
              organizationId,
              projectId: project.id,
              name: "Recovery check",
              scenarioKey: "recovery-check",
              description:
                "Checks the registered corrected checkout configuration in the isolated demo.",
              scenarioVersion: "1",
            },
          ]);
          return project;
        },
      );
      await audit(
        database,
        member.actor.userId,
        organizationId,
        request.id,
        "project.created",
        "project",
        created.id,
      );
      return reply.code(201).send({ data: created, requestId: request.id });
    } catch (error) {
      if (isUniqueViolation(error))
        throw new ApiError(
          409,
          "PROJECT_SLUG_IN_USE",
          "A project with this slug already exists in the organization.",
        );
      throw error;
    }
  });

  app.get<{ Params: ProjectParams }>(
    "/v1/projects/:projectId",
    async (request) => {
      const { project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
      );
      return success(request, project);
    },
  );

  app.patch<{ Params: ProjectParams }>(
    "/v1/projects/:projectId",
    async (request) => {
      const { member, project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
        "admin",
      );
      const input = parseBody(projectUpdateSchema, request.body);
      const [updated] = await database.withTenant(
        member.actor.userId,
        project.organizationId,
        (tx) =>
          tx
            .update(projects)
            .set({
              ...(input.name !== undefined ? { name: input.name } : {}),
              ...(input.description !== undefined
                ? { description: input.description }
                : {}),
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(projects.id, project.id),
                eq(projects.organizationId, project.organizationId),
              ),
            )
            .returning(),
      );
      if (!updated)
        throw new ApiError(
          404,
          "RESOURCE_NOT_FOUND",
          "The requested project was not found.",
        );
      await audit(
        database,
        member.actor.userId,
        project.organizationId,
        request.id,
        "project.updated",
        "project",
        project.id,
      );
      return success(request, updated);
    },
  );

  app.get<{ Params: ProjectParams }>(
    "/v1/projects/:projectId/environments",
    async (request) => {
      const { member, project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
      );
      const rows = await database.withTenant(
        member.actor.userId,
        project.organizationId,
        (tx) =>
          tx
            .select()
            .from(environments)
            .where(
              and(
                eq(environments.organizationId, project.organizationId),
                eq(environments.projectId, project.id),
              ),
            )
            .orderBy(asc(environments.name)),
      );
      return success(request, rows);
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/v1/projects/:projectId/environments",
    async (request, reply) => {
      const { member, project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
        "admin",
      );
      const input = parseBody(environmentInputSchema, request.body);
      try {
        const [created] = await database.withTenant(
          member.actor.userId,
          project.organizationId,
          (tx) =>
            tx
              .insert(environments)
              .values({
                organizationId: project.organizationId,
                projectId: project.id,
                name: input.name,
                slug: input.slug,
              })
              .returning(),
        );
        if (!created) throw new Error("ENVIRONMENT_CREATE_FAILED");
        await audit(
          database,
          member.actor.userId,
          project.organizationId,
          request.id,
          "environment.created",
          "environment",
          created.id,
        );
        return reply.code(201).send({ data: created, requestId: request.id });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ApiError(
            409,
            "ENVIRONMENT_SLUG_IN_USE",
            "An environment with this slug already exists in the project.",
          );
        throw error;
      }
    },
  );

  app.get<{ Params: ProjectParams }>(
    "/v1/projects/:projectId/services",
    async (request) => {
      const { member, project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
      );
      const rows = await database.withTenant(
        member.actor.userId,
        project.organizationId,
        (tx) =>
          tx
            .select()
            .from(services)
            .where(
              and(
                eq(services.organizationId, project.organizationId),
                eq(services.projectId, project.id),
              ),
            )
            .orderBy(asc(services.name)),
      );
      return success(request, rows);
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/v1/projects/:projectId/services",
    async (request, reply) => {
      const { member, project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
        "admin",
      );
      const input = parseBody(serviceInputSchema, request.body);
      try {
        const [created] = await database.withTenant(
          member.actor.userId,
          project.organizationId,
          (tx) =>
            tx
              .insert(services)
              .values({
                organizationId: project.organizationId,
                projectId: project.id,
                name: input.name,
                serviceKey: input.serviceKey,
                description: input.description ?? null,
              })
              .returning(),
        );
        if (!created) throw new Error("SERVICE_CREATE_FAILED");
        await audit(
          database,
          member.actor.userId,
          project.organizationId,
          request.id,
          "service.created",
          "service",
          created.id,
        );
        return reply.code(201).send({ data: created, requestId: request.id });
      } catch (error) {
        if (isUniqueViolation(error))
          throw new ApiError(
            409,
            "SERVICE_KEY_IN_USE",
            "A service with this key already exists in the project.",
          );
        throw error;
      }
    },
  );

  app.get<{ Params: ProjectParams; Querystring: { organizationId?: string } }>(
    "/v1/projects/:projectId/stream",
    async (request, reply) => {
      const projectId = requireUuid(request.params.projectId);
      const organizationId = request.query.organizationId;
      if (!organizationId)
        throw new ApiError(
          400,
          "ORGANIZATION_REQUIRED",
          "Select an organization before opening the live stream.",
        );
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      const [project] = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .select({ id: projects.id })
            .from(projects)
            .where(
              and(
                eq(projects.id, projectId),
                eq(projects.organizationId, organizationId),
              ),
            )
            .limit(1),
      );
      if (!project)
        throw new ApiError(
          404,
          "RESOURCE_NOT_FOUND",
          "The requested resource was not found.",
        );

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      });
      reply.raw.write(": connected\n\n");
      let closed = false;
      let sending = false;
      const sendSnapshot = async () => {
        if (closed || sending) return;
        sending = true;
        try {
          await requireMember(request, auth, database, organizationId);
          const snapshot = await database.withTenant(
            member.actor.userId,
            organizationId,
            async (tx) => {
              const incidentRows = await tx
                .select()
                .from(incidents)
                .where(
                  and(
                    eq(incidents.organizationId, organizationId),
                    eq(incidents.projectId, projectId),
                  ),
                )
                .orderBy(desc(incidents.lastSeenAt))
                .limit(50);
              const investigationRows = await tx
                .select({
                  id: investigations.id,
                  incidentId: investigations.incidentId,
                  status: investigations.status,
                  updatedAt: investigations.updatedAt,
                })
                .from(investigations)
                .innerJoin(
                  incidents,
                  and(
                    eq(incidents.id, investigations.incidentId),
                    eq(incidents.organizationId, investigations.organizationId),
                  ),
                )
                .where(
                  and(
                    eq(investigations.organizationId, organizationId),
                    eq(incidents.projectId, projectId),
                  ),
                )
                .orderBy(desc(investigations.updatedAt))
                .limit(20);
              const verificationRows = await tx
                .select({
                  id: verificationRuns.id,
                  incidentId: verificationRuns.incidentId,
                  status: verificationRuns.status,
                  createdAt: verificationRuns.createdAt,
                })
                .from(verificationRuns)
                .where(
                  and(
                    eq(verificationRuns.organizationId, organizationId),
                    eq(verificationRuns.projectId, projectId),
                  ),
                )
                .orderBy(desc(verificationRuns.createdAt))
                .limit(20);
              return {
                incidents: incidentRows,
                investigations: investigationRows,
                verifications: verificationRows,
                sentAt: new Date().toISOString(),
              };
            },
          );
          if (!closed) reply.raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);
        } catch {
          if (!closed)
            reply.raw.write(
              'event: error\ndata: {"code":"STREAM_UNAVAILABLE"}\n\n',
            );
          closeStream();
        } finally {
          sending = false;
        }
      };
      const heartbeat = setInterval(() => {
        if (!closed) reply.raw.write(": keep-alive\n\n");
      }, 15_000);
      const snapshots = setInterval(() => {
        void sendSnapshot();
      }, 2_000);
      const closeStream = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(snapshots);
        reply.raw.end();
      };
      reply.raw.once("close", closeStream);
      await sendSnapshot();
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/v1/projects/:projectId/api-keys",
    async (request, reply) => {
      const { member, project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
        "admin",
      );
      const input = parseBody(apiKeyInputSchema, request.body);
      const key = createProjectKey();
      const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
      if (expiresAt && expiresAt <= new Date())
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "The expiry must be in the future.",
        );
      const [row] = await database.withTenant(
        member.actor.userId,
        project.organizationId,
        (tx) =>
          tx
            .insert(apiKeys)
            .values({
              organizationId: project.organizationId,
              projectId: project.id,
              name: input.name,
              keyPrefix: key.prefix,
              keyHash: key.hash,
              scopes: ["events:write"],
              expiresAt,
              createdBy: member.actor.userId,
            })
            .returning({
              id: apiKeys.id,
              name: apiKeys.name,
              keyPrefix: apiKeys.keyPrefix,
              expiresAt: apiKeys.expiresAt,
              createdAt: apiKeys.createdAt,
            }),
      );
      if (!row) throw new Error("API_KEY_CREATE_FAILED");
      await audit(
        database,
        member.actor.userId,
        project.organizationId,
        request.id,
        "api_key.created",
        "api_key",
        row.id,
        { prefix: row.keyPrefix },
      );
      return reply.code(201).send({
        data: { ...row, plaintext: key.plaintext, shownOnce: true },
        requestId: request.id,
      });
    },
  );

  app.get<{ Params: ProjectParams }>(
    "/v1/projects/:projectId/api-keys",
    async (request) => {
      const { member, project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
      );
      const rows = await database.withTenant(
        member.actor.userId,
        project.organizationId,
        (tx) =>
          tx
            .select({
              id: apiKeys.id,
              name: apiKeys.name,
              keyPrefix: apiKeys.keyPrefix,
              scopes: apiKeys.scopes,
              expiresAt: apiKeys.expiresAt,
              lastUsedAt: apiKeys.lastUsedAt,
              revokedAt: apiKeys.revokedAt,
              createdAt: apiKeys.createdAt,
            })
            .from(apiKeys)
            .where(
              and(
                eq(apiKeys.organizationId, project.organizationId),
                eq(apiKeys.projectId, project.id),
              ),
            )
            .orderBy(desc(apiKeys.createdAt)),
      );
      return success(request, rows);
    },
  );

  app.delete<{ Params: { keyId: string } }>(
    "/v1/api-keys/:keyId",
    async (request) => {
      const keyId = requireUuid(request.params.keyId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "admin");
      const [updated] = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .update(apiKeys)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(apiKeys.id, keyId),
                eq(apiKeys.organizationId, organizationId),
                isNull(apiKeys.revokedAt),
              ),
            )
            .returning({ id: apiKeys.id }),
      );
      if (!updated)
        throw new ApiError(
          404,
          "RESOURCE_NOT_FOUND",
          "The requested resource was not found.",
        );
      await audit(
        database,
        member.actor.userId,
        organizationId,
        request.id,
        "api_key.revoked",
        "api_key",
        updated.id,
      );
      return success(request, { revoked: true });
    },
  );

  app.post<{ Params: { keyId: string } }>(
    "/v1/api-keys/:keyId/rotate",
    async (request, reply) => {
      const keyId = requireUuid(request.params.keyId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "admin");
      const key = createProjectKey();
      const result = await database.withTenant(
        member.actor.userId,
        organizationId,
        async (tx) => {
          const [existing] = await tx
            .select({
              id: apiKeys.id,
              projectId: apiKeys.projectId,
              name: apiKeys.name,
              scopes: apiKeys.scopes,
              expiresAt: apiKeys.expiresAt,
              revokedAt: apiKeys.revokedAt,
            })
            .from(apiKeys)
            .where(
              and(
                eq(apiKeys.id, keyId),
                eq(apiKeys.organizationId, organizationId),
              ),
            )
            .limit(1);
          if (!existing || existing.revokedAt)
            throw new ApiError(
              404,
              "RESOURCE_NOT_FOUND",
              "The requested resource was not found.",
            );
          const expiresAt =
            existing.expiresAt && existing.expiresAt > new Date()
              ? existing.expiresAt
              : null;
          const [created] = await tx
            .insert(apiKeys)
            .values({
              organizationId,
              projectId: existing.projectId,
              name: existing.name,
              keyPrefix: key.prefix,
              keyHash: key.hash,
              scopes: existing.scopes,
              expiresAt,
              createdBy: member.actor.userId,
            })
            .returning({
              id: apiKeys.id,
              name: apiKeys.name,
              keyPrefix: apiKeys.keyPrefix,
              scopes: apiKeys.scopes,
              expiresAt: apiKeys.expiresAt,
              createdAt: apiKeys.createdAt,
            });
          if (!created) throw new Error("API_KEY_ROTATE_FAILED");
          await tx
            .update(apiKeys)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(apiKeys.id, existing.id),
                eq(apiKeys.organizationId, organizationId),
                isNull(apiKeys.revokedAt),
              ),
            );
          await tx.insert(auditLogs).values({
            organizationId,
            actorUserId: member.actor.userId,
            action: "api_key.rotated",
            resourceType: "api_key",
            resourceId: created.id,
            requestId: request.id,
            metadata: {
              previousKeyId: existing.id,
              prefix: created.keyPrefix,
            },
          });
          return created;
        },
      );
      return reply.code(201).send({
        data: { ...result, plaintext: key.plaintext, shownOnce: true },
        requestId: request.id,
      });
    },
  );

  app.post(
    "/v1/ingest/events",
    {
      config: {
        rateLimit: {
          max: config.INGEST_RATE_LIMIT_PER_MINUTE,
          timeWindow: 60_000,
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request) => {
      const key = await authenticateProjectKey(request, database);
      let rateLimit;
      try {
        rateLimit = await dependencies.ingestionRateLimiter.consume({
          organizationId: key.organizationId,
          apiKeyId: key.id,
          perKeyLimit: config.INGEST_RATE_LIMIT_PER_MINUTE,
          perOrganizationLimit:
            config.INGEST_RATE_LIMIT_PER_ORGANIZATION_PER_MINUTE,
        });
      } catch {
        throw new ApiError(
          503,
          "RATE_LIMIT_UNAVAILABLE",
          "The ingestion rate-limit service is temporarily unavailable.",
        );
      }
      if (!rateLimit.allowed)
        throw new ApiError(
          429,
          "RATE_LIMITED",
          `Ingestion limit reached. Retry in ${Math.ceil(rateLimit.retryAfterMs / 1000)} seconds.`,
        );
      const header = request.headers["idempotency-key"];
      const result = await ingestTelemetry(
        database,
        key,
        request.body,
        typeof header === "string" ? header : undefined,
        request.id,
        config,
      );
      return { data: result, requestId: request.id };
    },
  );

  app.get<{ Params: ProjectParams }>(
    "/v1/projects/:projectId/deployments",
    async (request) => {
      const { member, project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
      );
      const rows = await database.withTenant(
        member.actor.userId,
        project.organizationId,
        (tx) =>
          tx
            .select()
            .from(deployments)
            .where(
              and(
                eq(deployments.organizationId, project.organizationId),
                eq(deployments.projectId, project.id),
              ),
            )
            .orderBy(desc(deployments.deployedAt))
            .limit(100),
      );
      return success(request, rows);
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/v1/projects/:projectId/deployments",
    async (request, reply) => {
      const { member, project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
        "admin",
      );
      const input = parseBody(deploymentInputSchema, request.body);
      const [environment] = await database.withTenant(
        member.actor.userId,
        project.organizationId,
        (tx) =>
          tx
            .select({ id: environments.id })
            .from(environments)
            .where(
              and(
                eq(environments.id, input.environmentId),
                eq(environments.organizationId, project.organizationId),
                eq(environments.projectId, project.id),
              ),
            )
            .limit(1),
      );
      if (!environment)
        throw new ApiError(
          404,
          "ENVIRONMENT_NOT_FOUND",
          "The selected environment does not belong to this project.",
        );
      const [created] = await database.withTenant(
        member.actor.userId,
        project.organizationId,
        (tx) =>
          tx
            .insert(deployments)
            .values({
              organizationId: project.organizationId,
              projectId: project.id,
              environmentId: input.environmentId,
              version: input.version,
              commitSha: input.commitSha ?? null,
              status: input.status,
              deployedAt: new Date(input.deployedAt),
              source: "manual",
              metadata: input.metadata,
            })
            .returning(),
      );
      if (!created) throw new Error("DEPLOYMENT_CREATE_FAILED");
      await audit(
        database,
        member.actor.userId,
        project.organizationId,
        request.id,
        "deployment.recorded",
        "deployment",
        created.id,
        { version: created.version, status: created.status },
      );
      return reply.code(201).send({ data: created, requestId: request.id });
    },
  );

  app.post<{ Params: ProjectParams }>(
    "/v1/projects/:projectId/demo/failure",
    async (request, reply) => {
      const { member, project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
        "member",
      );
      const eventId = randomUUID();
      const now = new Date();
      const result = await database.withTenant(
        member.actor.userId,
        project.organizationId,
        async (tx) => {
          const [environment] = await tx
            .select({ id: environments.id, slug: environments.slug })
            .from(environments)
            .where(
              and(
                eq(environments.organizationId, project.organizationId),
                eq(environments.projectId, project.id),
                eq(environments.slug, "staging"),
              ),
            )
            .limit(1);
          const [service] = await tx
            .select({ id: services.id, serviceKey: services.serviceKey })
            .from(services)
            .where(
              and(
                eq(services.organizationId, project.organizationId),
                eq(services.projectId, project.id),
                eq(services.serviceKey, "checkout-api"),
              ),
            )
            .limit(1);
          if (!environment || !service)
            throw new ApiError(
              404,
              "DEMO_NOT_CONFIGURED",
              "The synthetic demo service is not configured for this project.",
            );
          const version = `demo-${now.toISOString().replace(/[:.]/g, "-")}`;
          const [deployment] = await tx
            .insert(deployments)
            .values({
              organizationId: project.organizationId,
              projectId: project.id,
              environmentId: environment.id,
              version,
              status: "succeeded",
              deployedAt: now,
              source: "synthetic-demo",
              metadata: { simulated: true },
            })
            .returning({
              id: deployments.id,
              version: deployments.version,
              deployedAt: deployments.deployedAt,
            });
          const occurredAt = new Date(now.getTime() + 1000);
          const eventInput = {
            eventType: "error" as const,
            occurredAt: occurredAt.toISOString(),
            service: service.serviceKey,
            environment: environment.slug,
            severity: "error" as const,
            traceId: randomBytes(12).toString("hex"),
            message:
              "Database connection failed after the simulated deployment",
            attributes: {
              error_type: "ConnectionError",
              deployment_version: version,
              source: "synthetic-demo",
            },
          };
          const fingerprint = fingerprintEvent(
            eventInput,
            service.serviceKey,
            environment.slug,
          );
          await tx.insert(telemetryEvents).values({
            id: eventId,
            organizationId: project.organizationId,
            projectId: project.id,
            environmentId: environment.id,
            serviceId: service.id,
            eventType: eventInput.eventType,
            severity: eventInput.severity,
            occurredAt,
            traceId: eventInput.traceId,
            fingerprint,
            groupingVersion: "fingerprint-v1",
            message: redactText(eventInput.message),
            attributes: eventInput.attributes,
            idempotencyKey: `demo:${eventId}`,
            contentHash: createHash("sha256")
              .update(eventInput.message)
              .digest("hex"),
          });
          await tx.insert(outbox).values({
            organizationId: project.organizationId,
            topic: "event.correlation",
            payload: {
              eventId,
              projectId: project.id,
              organizationId: project.organizationId,
              requestId: request.id,
            },
          });
          await tx.insert(auditLogs).values({
            organizationId: project.organizationId,
            actorUserId: member.actor.userId,
            action: "demo.failure_triggered",
            resourceType: "telemetry_event",
            resourceId: eventId,
            requestId: request.id,
            metadata: { deploymentVersion: version, synthetic: true },
          });
          return {
            deployment,
            eventId,
            occurredAt: occurredAt.toISOString(),
            synthetic: true,
          };
        },
      );
      return reply.code(202).send({ data: result, requestId: request.id });
    },
  );

  app.get<{
    Params: ProjectParams;
    Querystring: {
      cursor?: string;
      status?: string;
      severity?: string;
      limit?: string;
    };
  }>("/v1/projects/:projectId/incidents", async (request) => {
    const { member, project } = await projectContext(
      request,
      dependencies,
      request.params.projectId,
    );
    const page = parseBody(cursorPageSchema, {
      limit: request.query.limit ?? 50,
      ...(request.query.cursor === undefined
        ? {}
        : { cursor: request.query.cursor }),
    });
    const statusResult =
      request.query.status === undefined
        ? undefined
        : incidentStatusSchema.safeParse(request.query.status);
    if (statusResult && !statusResult.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "The status filter is invalid.",
      );
    const status = statusResult?.success ? statusResult.data : null;
    const severityResult =
      request.query.severity === undefined
        ? undefined
        : incidentSeveritySchema.safeParse(request.query.severity);
    if (severityResult && !severityResult.success)
      throw new ApiError(
        400,
        "VALIDATION_ERROR",
        "The severity filter is invalid.",
      );
    const severity = severityResult?.success ? severityResult.data : null;
    const cursorContext = {
      organizationId: project.organizationId,
      projectId: project.id,
      status,
      severity,
    };
    let cursor: ReturnType<typeof incidentCursorSchema.parse> | undefined;
    if (page.cursor) {
      try {
        cursor = decodeCursor(
          page.cursor,
          config.AUTH_SECRET,
          incidentCursorSchema,
          cursorContext,
        );
      } catch (error) {
        if (!(error instanceof InvalidCursorError)) throw error;
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "The incident cursor is invalid for these filters.",
        );
      }
    }
    const conditions = [
      eq(incidents.organizationId, project.organizationId),
      eq(incidents.projectId, project.id),
    ];
    if (status) conditions.push(eq(incidents.status, status));
    if (severity) conditions.push(eq(incidents.severity, severity));
    if (cursor) {
      const cursorCondition = or(
        lt(incidents.lastSeenAt, new Date(cursor.lastSeenAt)),
        and(
          eq(incidents.lastSeenAt, new Date(cursor.lastSeenAt)),
          lt(incidents.id, cursor.id),
        ),
      );
      if (cursorCondition) conditions.push(cursorCondition);
    }
    const rows = await database.withTenant(
      member.actor.userId,
      project.organizationId,
      (tx) =>
        tx
          .select()
          .from(incidents)
          .where(and(...conditions))
          .orderBy(desc(incidents.lastSeenAt), desc(incidents.id))
          .limit(page.limit + 1),
    );
    const hasMore = rows.length > page.limit;
    const data = rows.slice(0, page.limit);
    const last = data.at(-1);
    return {
      data,
      page: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor(
                {
                  version: 1,
                  kind: "incident",
                  ...cursorContext,
                  lastSeenAt: last.lastSeenAt.toISOString(),
                  id: last.id,
                },
                config.AUTH_SECRET,
              )
            : null,
      },
      requestId: request.id,
    };
  });

  app.get<{ Params: IncidentParams }>(
    "/v1/incidents/:incidentId",
    async (request) => {
      const incidentId = requireUuid(request.params.incidentId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      const [incident] = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .select()
            .from(incidents)
            .where(
              and(
                eq(incidents.id, incidentId),
                eq(incidents.organizationId, organizationId),
              ),
            )
            .limit(1),
      );
      if (!incident)
        throw new ApiError(
          404,
          "RESOURCE_NOT_FOUND",
          "The requested resource was not found.",
        );
      const [events, correlatedDeployments] = await database.withTenant(
        member.actor.userId,
        organizationId,
        async (tx) => {
          const eventRows = await tx
            .select({
              linkId: incidentEvents.id,
              eventId: telemetryEvents.id,
              eventType: telemetryEvents.eventType,
              severity: telemetryEvents.severity,
              occurredAt: telemetryEvents.occurredAt,
              message: telemetryEvents.message,
              traceId: telemetryEvents.traceId,
              attributes: telemetryEvents.attributes,
              linkType: incidentEvents.eventType,
            })
            .from(incidentEvents)
            .innerJoin(
              telemetryEvents,
              and(
                eq(telemetryEvents.id, incidentEvents.telemetryEventId),
                eq(
                  telemetryEvents.organizationId,
                  incidentEvents.organizationId,
                ),
              ),
            )
            .where(
              and(
                eq(incidentEvents.organizationId, organizationId),
                eq(incidentEvents.incidentId, incidentId),
              ),
            )
            .orderBy(asc(telemetryEvents.occurredAt))
            .limit(100);
          const deploymentsWhere = [
            eq(deployments.organizationId, organizationId),
            eq(deployments.projectId, incident.projectId),
            gte(
              deployments.deployedAt,
              new Date(incident.firstSeenAt.getTime() - 60 * 60 * 1000),
            ),
            lt(deployments.deployedAt, incident.firstSeenAt),
          ];
          if (incident.environmentId)
            deploymentsWhere.push(
              eq(deployments.environmentId, incident.environmentId),
            );
          const deploymentRows = await tx
            .select()
            .from(deployments)
            .where(and(...deploymentsWhere))
            .orderBy(desc(deployments.deployedAt))
            .limit(10);
          return [eventRows, deploymentRows] as const;
        },
      );
      return success(request, {
        incident,
        events,
        relatedDeployments: correlatedDeployments.map((item) => ({
          ...item,
          relation: "temporal correlation; not proof of causation",
        })),
      });
    },
  );

  app.get<{
    Params: IncidentParams;
    Querystring: { cursor?: string; limit?: string };
  }>("/v1/incidents/:incidentId/events", async (request) => {
    const incidentId = requireUuid(request.params.incidentId);
    const organizationId = organizationHeader(request);
    const member = await requireMember(request, auth, database, organizationId);
    const page = parseBody(cursorPageSchema, {
      limit: request.query.limit ?? 50,
      ...(request.query.cursor === undefined
        ? {}
        : { cursor: request.query.cursor }),
    });
    const cursorContext = { organizationId, incidentId };
    let cursor: ReturnType<typeof incidentEventCursorSchema.parse> | undefined;
    if (page.cursor) {
      try {
        cursor = decodeCursor(
          page.cursor,
          config.AUTH_SECRET,
          incidentEventCursorSchema,
          cursorContext,
        );
      } catch (error) {
        if (!(error instanceof InvalidCursorError)) throw error;
        throw new ApiError(
          400,
          "VALIDATION_ERROR",
          "The event cursor is invalid for this incident.",
        );
      }
    }
    const rows = await database.withTenant(
      member.actor.userId,
      organizationId,
      async (tx) => {
        const conditions = [
          eq(incidentEvents.organizationId, organizationId),
          eq(incidentEvents.incidentId, incidentId),
        ];
        if (cursor) {
          const cursorCondition = or(
            gt(telemetryEvents.occurredAt, new Date(cursor.occurredAt)),
            and(
              eq(telemetryEvents.occurredAt, new Date(cursor.occurredAt)),
              gt(incidentEvents.id, cursor.id),
            ),
          );
          if (cursorCondition) conditions.push(cursorCondition);
        }
        return tx
          .select({
            linkId: incidentEvents.id,
            eventId: telemetryEvents.id,
            eventType: telemetryEvents.eventType,
            severity: telemetryEvents.severity,
            occurredAt: telemetryEvents.occurredAt,
            message: telemetryEvents.message,
            traceId: telemetryEvents.traceId,
            attributes: telemetryEvents.attributes,
            linkType: incidentEvents.eventType,
          })
          .from(incidentEvents)
          .innerJoin(
            telemetryEvents,
            and(
              eq(telemetryEvents.id, incidentEvents.telemetryEventId),
              eq(telemetryEvents.organizationId, incidentEvents.organizationId),
            ),
          )
          .where(and(...conditions))
          .orderBy(asc(telemetryEvents.occurredAt), asc(incidentEvents.id))
          .limit(page.limit + 1);
      },
    );
    const hasMore = rows.length > page.limit;
    const data = rows.slice(0, page.limit);
    const last = data.at(-1);
    return {
      data,
      page: {
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor(
                {
                  version: 1,
                  kind: "incident-event",
                  ...cursorContext,
                  occurredAt: last.occurredAt.toISOString(),
                  id: last.linkId,
                },
                config.AUTH_SECRET,
              )
            : null,
      },
      requestId: request.id,
    };
  });

  app.patch<{ Params: IncidentParams }>(
    "/v1/incidents/:incidentId/status",
    async (request) => {
      const incidentId = requireUuid(request.params.incidentId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "member");
      const input = parseBody(incidentStatusInputSchema, request.body);
      const [updated] = await database.withTenant(
        member.actor.userId,
        organizationId,
        async (tx) => {
          const [current] = await tx
            .select({ id: incidents.id, status: incidents.status })
            .from(incidents)
            .where(
              and(
                eq(incidents.id, incidentId),
                eq(incidents.organizationId, organizationId),
              ),
            )
            .limit(1);
          if (!current)
            throw new ApiError(
              404,
              "RESOURCE_NOT_FOUND",
              "The requested resource was not found.",
            );
          const from = incidentStatusSchema.parse(current.status);
          if (!canTransitionIncident(from, input.status))
            throw new ApiError(
              409,
              "INVALID_STATE_TRANSITION",
              "That incident status transition is not allowed.",
            );
          requireIncidentTransition(from, input.status);
          const [row] = await tx
            .update(incidents)
            .set({
              status: input.status,
              resolvedAt: input.status === "resolved" ? new Date() : null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(incidents.id, incidentId),
                eq(incidents.organizationId, organizationId),
              ),
            )
            .returning();
          await tx.insert(incidentEvents).values({
            organizationId,
            incidentId,
            eventType: "status_changed",
            payload: {
              from,
              to: input.status,
              actorUserId: member.actor.userId,
            },
          });
          await tx.insert(auditLogs).values({
            organizationId,
            actorUserId: member.actor.userId,
            action: "incident.status_changed",
            resourceType: "incident",
            resourceId: incidentId,
            requestId: request.id,
            metadata: { from, to: input.status },
          });
          return [row];
        },
      );
      return success(request, updated);
    },
  );

  app.get<{ Params: IncidentParams }>(
    "/v1/incidents/:incidentId/investigations",
    async (request) => {
      const incidentId = requireUuid(request.params.incidentId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      const rows = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .select({
              id: investigations.id,
              status: investigations.status,
              provider: investigations.provider,
              model: investigations.model,
              summary: investigations.summary,
              errorCode: investigations.errorCode,
              createdAt: investigations.createdAt,
              finishedAt: investigations.finishedAt,
            })
            .from(investigations)
            .where(
              and(
                eq(investigations.organizationId, organizationId),
                eq(investigations.incidentId, incidentId),
              ),
            )
            .orderBy(desc(investigations.createdAt))
            .limit(30),
      );
      return success(request, rows);
    },
  );

  app.post<{ Params: IncidentParams }>(
    "/v1/incidents/:incidentId/investigations",
    {
      config: {
        rateLimit: {
          max: config.INVESTIGATION_RATE_LIMIT_PER_HOUR,
          timeWindow: 60 * 60_000,
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const incidentId = requireUuid(request.params.incidentId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "member");
      parseBody(investigationRequestSchema, request.body ?? {});
      const provider = config.AI_PROVIDER;
      const model =
        provider === "mock"
          ? "signalforge-deterministic-v1"
          : (config.AI_MODEL ?? "");
      const created = await database.withTenant(
        member.actor.userId,
        organizationId,
        async (tx) => {
          const [incident] = await tx
            .select({ id: incidents.id, projectId: incidents.projectId })
            .from(incidents)
            .where(
              and(
                eq(incidents.id, incidentId),
                eq(incidents.organizationId, organizationId),
              ),
            )
            .limit(1);
          if (!incident)
            throw new ApiError(
              404,
              "RESOURCE_NOT_FOUND",
              "The requested resource was not found.",
            );
          const [investigation] = await tx
            .insert(investigations)
            .values({
              organizationId,
              incidentId,
              status: "queued",
              provider,
              model,
              promptVersion: "investigation-v1",
              createdBy: member.actor.userId,
            })
            .returning({
              id: investigations.id,
              status: investigations.status,
              createdAt: investigations.createdAt,
            });
          if (!investigation) throw new Error("INVESTIGATION_CREATE_FAILED");
          await tx.insert(outbox).values({
            organizationId,
            topic: "investigation.run",
            payload: {
              investigationId: investigation.id,
              incidentId,
              projectId: incident.projectId,
              organizationId,
            },
          });
          await tx.insert(auditLogs).values({
            organizationId,
            actorUserId: member.actor.userId,
            action: "investigation.created",
            resourceType: "investigation",
            resourceId: investigation.id,
            requestId: request.id,
            metadata: { provider },
          });
          return investigation;
        },
      );
      return reply.code(202).send({
        data: { ...created, statusUrl: `/v1/investigations/${created.id}` },
        requestId: request.id,
      });
    },
  );

  app.get<{ Params: InvestigationParams }>(
    "/v1/investigations/:investigationId",
    async (request) => {
      const investigationId = requireUuid(request.params.investigationId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      const [row] = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .select()
            .from(investigations)
            .where(
              and(
                eq(investigations.id, investigationId),
                eq(investigations.organizationId, organizationId),
              ),
            )
            .limit(1),
      );
      if (!row)
        throw new ApiError(
          404,
          "RESOURCE_NOT_FOUND",
          "The requested resource was not found.",
        );
      return success(request, row);
    },
  );

  app.post<{ Params: InvestigationParams }>(
    "/v1/investigations/:investigationId/cancel",
    async (request) => {
      const investigationId = requireUuid(request.params.investigationId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "member");
      const result = await cancelQueuedInvestigation(database, {
        organizationId,
        investigationId,
        actorUserId: member.actor.userId,
        requestId: request.id,
      });
      if (result.kind === "missing")
        throw new ApiError(
          404,
          "RESOURCE_NOT_FOUND",
          "The requested resource was not found.",
        );
      if (result.kind === "not_cancellable")
        throw new ApiError(
          409,
          "INVESTIGATION_NOT_CANCELLABLE",
          "Only a queued investigation can be cancelled.",
        );
      return success(request, result.investigation);
    },
  );

  app.post<{ Params: InvestigationParams }>(
    "/v1/investigations/:investigationId/retry",
    {
      config: {
        rateLimit: {
          max: config.INVESTIGATION_RATE_LIMIT_PER_HOUR,
          timeWindow: 60 * 60_000,
          keyGenerator: (request) => request.ip,
        },
      },
    },
    async (request, reply) => {
      const investigationId = requireUuid(request.params.investigationId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "member");
      const result = await retryFailedInvestigation(database, {
        organizationId,
        investigationId,
        actorUserId: member.actor.userId,
        requestId: request.id,
      });
      if (result.kind === "missing")
        throw new ApiError(
          404,
          "RESOURCE_NOT_FOUND",
          "The requested resource was not found.",
        );
      if (result.kind === "retry_limit")
        throw new ApiError(
          409,
          "INVESTIGATION_RETRY_LIMIT",
          "The manual retry limit for this investigation has been reached.",
        );
      if (result.kind === "not_retryable")
        throw new ApiError(
          409,
          "INVESTIGATION_NOT_RETRYABLE",
          "This investigation cannot be retried in its current state.",
        );
      return reply.code(202).send({
        data: {
          ...result.investigation,
          statusUrl: `/v1/investigations/${result.investigation.id}`,
        },
        requestId: request.id,
      });
    },
  );

  app.get<{ Params: InvestigationParams }>(
    "/v1/investigations/:investigationId/evidence",
    async (request) => {
      const investigationId = requireUuid(request.params.investigationId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      const rows = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .select()
            .from(evidenceItems)
            .where(
              and(
                eq(evidenceItems.organizationId, organizationId),
                eq(evidenceItems.investigationId, investigationId),
              ),
            )
            .orderBy(asc(evidenceItems.capturedAt))
            .limit(50),
      );
      return success(request, rows);
    },
  );

  app.get<{ Params: InvestigationParams }>(
    "/v1/investigations/:investigationId/hypotheses",
    async (request) => {
      const investigationId = requireUuid(request.params.investigationId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      const rows = await database.withTenant(
        member.actor.userId,
        organizationId,
        async (tx) => {
          const items = await tx
            .select()
            .from(hypotheses)
            .where(
              and(
                eq(hypotheses.organizationId, organizationId),
                eq(hypotheses.investigationId, investigationId),
              ),
            )
            .orderBy(asc(hypotheses.sortOrder));
          if (items.length === 0) return [];
          const links = await tx
            .select()
            .from(hypothesisEvidence)
            .where(
              and(
                eq(hypothesisEvidence.organizationId, organizationId),
                eq(hypothesisEvidence.investigationId, investigationId),
              ),
            );
          return items.map((item) => ({
            ...item,
            evidence: links.filter((link) => link.hypothesisId === item.id),
          }));
        },
      );
      return success(request, rows);
    },
  );

  app.post<{ Params: IncidentParams }>(
    "/v1/incidents/:incidentId/verification-runs",
    async (request, reply) => {
      const incidentId = requireUuid(request.params.incidentId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "member");
      const input = parseBody(verificationRequestSchema, request.body);
      const run = await database.withTenant(
        member.actor.userId,
        organizationId,
        async (tx) => {
          const [incident] = await tx
            .select({ id: incidents.id, projectId: incidents.projectId })
            .from(incidents)
            .where(
              and(
                eq(incidents.id, incidentId),
                eq(incidents.organizationId, organizationId),
              ),
            )
            .limit(1);
          if (!incident)
            throw new ApiError(
              404,
              "RESOURCE_NOT_FOUND",
              "The requested resource was not found.",
            );
          const [scenario] = await tx
            .select()
            .from(testScenarios)
            .where(
              and(
                eq(testScenarios.organizationId, organizationId),
                eq(testScenarios.projectId, incident.projectId),
                eq(testScenarios.scenarioKey, input.scenarioKey),
                eq(testScenarios.enabled, true),
              ),
            )
            .limit(1);
          if (!scenario)
            throw new ApiError(
              404,
              "SCENARIO_NOT_AVAILABLE",
              "The registered scenario is not available for this project.",
            );
          const [created] = await tx
            .insert(verificationRuns)
            .values({
              organizationId,
              projectId: incident.projectId,
              incidentId,
              scenarioId: scenario.id,
              scenarioVersion: scenario.scenarioVersion,
              commitSha: input.commitSha ?? null,
              status: "queued",
              triggeredBy: member.actor.userId,
            })
            .returning({
              id: verificationRuns.id,
              status: verificationRuns.status,
              scenarioVersion: verificationRuns.scenarioVersion,
              createdAt: verificationRuns.createdAt,
            });
          if (!created) throw new Error("VERIFICATION_CREATE_FAILED");
          await tx.insert(outbox).values({
            organizationId,
            topic: "verification.run",
            payload: {
              runId: created.id,
              incidentId,
              scenarioId: scenario.id,
              projectId: incident.projectId,
              organizationId,
            },
          });
          await tx.insert(auditLogs).values({
            organizationId,
            actorUserId: member.actor.userId,
            action: "verification.created",
            resourceType: "verification_run",
            resourceId: created.id,
            requestId: request.id,
            metadata: {
              scenarioKey: scenario.scenarioKey,
              scenarioVersion: scenario.scenarioVersion,
            },
          });
          return created;
        },
      );
      return reply.code(202).send({ data: run, requestId: request.id });
    },
  );

  app.get<{ Params: VerificationParams }>(
    "/v1/verification-runs/:runId",
    async (request) => {
      const runId = requireUuid(request.params.runId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      const [row] = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .select()
            .from(verificationRuns)
            .where(
              and(
                eq(verificationRuns.id, runId),
                eq(verificationRuns.organizationId, organizationId),
              ),
            )
            .limit(1),
      );
      if (!row)
        throw new ApiError(
          404,
          "RESOURCE_NOT_FOUND",
          "The requested resource was not found.",
        );
      return success(request, row);
    },
  );

  app.get<{ Params: IncidentParams }>(
    "/v1/incidents/:incidentId/verification-runs",
    async (request) => {
      const incidentId = requireUuid(request.params.incidentId);
      const organizationId = organizationHeader(request);
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      const rows = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .select()
            .from(verificationRuns)
            .where(
              and(
                eq(verificationRuns.organizationId, organizationId),
                eq(verificationRuns.incidentId, incidentId),
              ),
            )
            .orderBy(desc(verificationRuns.createdAt))
            .limit(30),
      );
      return success(request, rows);
    },
  );

  app.get<{ Params: ProjectParams }>(
    "/v1/projects/:projectId/test-scenarios",
    async (request) => {
      const { member, project } = await projectContext(
        request,
        dependencies,
        request.params.projectId,
      );
      const rows = await database.withTenant(
        member.actor.userId,
        project.organizationId,
        (tx) =>
          tx
            .select({
              id: testScenarios.id,
              name: testScenarios.name,
              scenarioKey: testScenarios.scenarioKey,
              description: testScenarios.description,
              scenarioVersion: testScenarios.scenarioVersion,
            })
            .from(testScenarios)
            .where(
              and(
                eq(testScenarios.organizationId, project.organizationId),
                eq(testScenarios.projectId, project.id),
                eq(testScenarios.enabled, true),
              ),
            ),
      );
      return success(request, rows);
    },
  );

  app.get<{ Querystring: { organizationId?: string; limit?: string } }>(
    "/v1/audit",
    async (request) => {
      const organizationId = request.query.organizationId;
      if (!organizationId)
        throw new ApiError(
          400,
          "ORGANIZATION_REQUIRED",
          "Provide an organizationId query parameter.",
        );
      const member = await requireMember(
        request,
        auth,
        database,
        organizationId,
      );
      requireRole(member, "admin");
      const limit = Math.min(
        Math.max(Number(request.query.limit ?? 50) || 50, 1),
        100,
      );
      const rows = await database.withTenant(
        member.actor.userId,
        organizationId,
        (tx) =>
          tx
            .select()
            .from(auditLogs)
            .where(eq(auditLogs.organizationId, organizationId))
            .orderBy(desc(auditLogs.createdAt))
            .limit(limit),
      );
      return success(request, rows);
    },
  );
}
