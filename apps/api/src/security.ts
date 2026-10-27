import { fromNodeHeaders } from "better-auth/node";
import { and, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { SignalForgeAuth } from "@signalforge/auth";
import {
  membershipRoleSchema,
  type MembershipRole,
} from "@signalforge/contracts";
import type { createDatabase } from "@signalforge/db";
import { memberships } from "@signalforge/db";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Actor {
  userId: string;
  email: string;
  displayName: string;
}
export interface MemberContext {
  actor: Actor;
  role: MembershipRole;
  organizationId: string;
}
export type DatabaseHandle = ReturnType<typeof createDatabase>;

export async function requireActor(
  request: FastifyRequest,
  auth: SignalForgeAuth,
): Promise<Actor> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
  if (!session) throw new ApiError(401, "UNAUTHORIZED", "Sign in to continue.");
  return {
    userId: session.user.id,
    email: session.user.email,
    displayName: session.user.name,
  };
}

export async function requireMember(
  request: FastifyRequest,
  auth: SignalForgeAuth,
  database: DatabaseHandle,
  organizationId: string,
): Promise<MemberContext> {
  const actor = await requireActor(request, auth);
  const [membership] = await database.db
    .select({ role: memberships.role })
    .from(memberships)
    .where(
      and(
        eq(memberships.organizationId, organizationId),
        eq(memberships.userId, actor.userId),
      ),
    )
    .limit(1);
  if (!membership)
    throw new ApiError(
      404,
      "RESOURCE_NOT_FOUND",
      "The requested resource was not found.",
    );
  const role = membershipRoleSchema.parse(membership.role);
  return { actor, organizationId, role };
}

export function requireRole(
  member: MemberContext,
  minimum: "viewer" | "member" | "admin" | "owner",
): void {
  const levels: Record<MembershipRole, number> = {
    viewer: 0,
    member: 1,
    admin: 2,
    owner: 3,
  };
  const required =
    minimum === "viewer"
      ? 0
      : minimum === "member"
        ? 1
        : minimum === "admin"
          ? 2
          : 3;
  if (levels[member.role] < required)
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Your organization role does not allow this action.",
    );
}

export function organizationHeader(request: FastifyRequest): string {
  const value = request.headers["x-organization-id"];
  if (typeof value !== "string" || value.length > 64)
    throw new ApiError(
      400,
      "ORGANIZATION_REQUIRED",
      "Select an organization before continuing.",
    );
  return value;
}

export function safeErrorMessage(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
} {
  if (error instanceof ApiError)
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  return {
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: "The request could not be completed.",
  };
}
