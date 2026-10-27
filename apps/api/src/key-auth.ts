import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { apiKeys } from "@signalforge/db";
import { ApiError, type DatabaseHandle } from "./security.js";

export function createProjectKey(): {
  plaintext: string;
  prefix: string;
  hash: string;
} {
  const id = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `sf_live_${id}_${secret}`;
  return {
    plaintext,
    prefix: `sf_live_${id}`,
    hash: hashProjectKey(plaintext),
  };
}

function hashProjectKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export interface ApiKeyContext {
  id: string;
  organizationId: string;
  projectId: string;
}

export async function authenticateProjectKey(
  request: FastifyRequest,
  database: DatabaseHandle,
): Promise<ApiKeyContext> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer "))
    throw new ApiError(
      401,
      "API_KEY_REQUIRED",
      "A project API key is required.",
    );
  const rawKey = authorization.slice("Bearer ".length);
  const match = /^(sf_live_[a-f0-9]{12})_([A-Za-z0-9_-]{40,60})$/.exec(rawKey);
  if (!match)
    throw new ApiError(
      401,
      "API_KEY_INVALID",
      "The project API key is invalid.",
    );
  const prefix = match[1];
  if (!prefix)
    throw new ApiError(
      401,
      "API_KEY_INVALID",
      "The project API key is invalid.",
    );
  const [record] = await database.db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.key_lookup', 'on', true)`);
    return tx
      .select({
        id: apiKeys.id,
        organizationId: apiKeys.organizationId,
        projectId: apiKeys.projectId,
        keyHash: apiKeys.keyHash,
        expiresAt: apiKeys.expiresAt,
        scopes: apiKeys.scopes,
      })
      .from(apiKeys)
      .where(and(eq(apiKeys.keyPrefix, prefix), isNull(apiKeys.revokedAt)))
      .limit(1);
  });
  if (!record)
    throw new ApiError(
      401,
      "API_KEY_INVALID",
      "The project API key is invalid.",
    );
  const actual = Buffer.from(hashProjectKey(rawKey), "hex");
  const expected = Buffer.from(record.keyHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw new ApiError(
      401,
      "API_KEY_INVALID",
      "The project API key is invalid.",
    );
  if (record.expiresAt !== null && record.expiresAt <= new Date())
    throw new ApiError(
      401,
      "API_KEY_EXPIRED",
      "The project API key has expired.",
    );
  if (!record.scopes.includes("events:write"))
    throw new ApiError(
      403,
      "API_KEY_SCOPE_REQUIRED",
      "The project API key does not have event write access.",
    );
  return {
    id: record.id,
    organizationId: record.organizationId,
    projectId: record.projectId,
  };
}
