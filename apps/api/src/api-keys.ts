import { and, eq, isNull } from "drizzle-orm";
import { apiKeys, auditLogs } from "@signalforge/db";
import { createProjectKey } from "./key-auth.js";
import { ApiError } from "./security.js";
import type { DatabaseHandle } from "./security.js";

export type ApiKeyRotationResult =
  | {
      kind: "rotated";
      key: {
        id: string;
        name: string;
        keyPrefix: string;
        scopes: string[];
        expiresAt: Date | null;
        createdAt: Date;
        plaintext: string;
      };
    }
  | { kind: "missing" }
  | { kind: "already_revoked" }
  | { kind: "expired" };

export async function rotateProjectKey(
  database: DatabaseHandle,
  input: {
    organizationId: string;
    keyId: string;
    actorUserId: string;
    requestId: string;
  },
): Promise<ApiKeyRotationResult> {
  const replacement = createProjectKey();
  return database.withTenant(
    input.actorUserId,
    input.organizationId,
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
            eq(apiKeys.id, input.keyId),
            eq(apiKeys.organizationId, input.organizationId),
          ),
        )
        .for("update")
        .limit(1);
      if (!existing) return { kind: "missing" };
      if (existing.revokedAt) return { kind: "already_revoked" };
      const now = new Date();
      if (existing.expiresAt !== null && existing.expiresAt <= now)
        return { kind: "expired" };

      const [created] = await tx
        .insert(apiKeys)
        .values({
          organizationId: input.organizationId,
          projectId: existing.projectId,
          name: existing.name,
          keyPrefix: replacement.prefix,
          keyHash: replacement.hash,
          scopes: existing.scopes,
          expiresAt: existing.expiresAt,
          createdBy: input.actorUserId,
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

      const [revoked] = await tx
        .update(apiKeys)
        .set({ revokedAt: now })
        .where(
          and(
            eq(apiKeys.id, existing.id),
            eq(apiKeys.organizationId, input.organizationId),
            isNull(apiKeys.revokedAt),
          ),
        )
        .returning({ id: apiKeys.id });
      if (!revoked) {
        throw new ApiError(
          409,
          "API_KEY_ROTATION_CONFLICT",
          "The API key could not be rotated because its state changed.",
        );
      }

      await tx.insert(auditLogs).values({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        action: "api_key.rotated",
        resourceType: "api_key",
        resourceId: created.id,
        requestId: input.requestId,
        metadata: {
          previousKeyId: existing.id,
          prefix: created.keyPrefix,
        },
      });

      return {
        kind: "rotated",
        key: { ...created, plaintext: replacement.plaintext },
      };
    },
  );
}
