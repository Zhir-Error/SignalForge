import { createHash, randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  apiKeys,
  auditLogs,
  createDatabase,
  organizations,
  projects,
  users,
} from "../packages/db/src/index.js";
import { rotateProjectKey } from "../apps/api/src/api-keys.js";

loadEnv();
let database: ReturnType<typeof createDatabase> | undefined;
let setupDatabase: ReturnType<typeof createDatabase> | undefined;
const connectionString = process.env.DATABASE_URL;
const integration = describe.skipIf(!connectionString);
if (connectionString) {
  database = createDatabase(connectionString);
  setupDatabase = createDatabase(
    process.env.MIGRATION_DATABASE_URL ?? connectionString,
  );
}

integration("API key rotation", () => {
  afterAll(async () => {
    await database?.close();
    await setupDatabase?.close();
  });

  it("rotates a key, returns plaintext once, revokes the old key, and preserves scopes/project/expiry", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");

    const organizationId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID();
    const keyId = randomUUID();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const suffix = randomUUID().slice(0, 8);
    try {
      await setupDatabase!.db.insert(users).values({
        id: userId,
        name: "Rotation Tester",
        email: `rotation-${suffix}@example.test`,
      });
      await setupDatabase!.db.insert(organizations).values({
        id: organizationId,
        name: "Rotation Org",
        slug: `rotation-org-${suffix}`,
      });
      await setupDatabase!.db.insert(projects).values({
        id: projectId,
        organizationId,
        name: "Rotation Project",
        slug: `rotation-project-${suffix}`,
      });
      await setupDatabase!.db.insert(apiKeys).values({
        id: keyId,
        organizationId,
        projectId,
        name: "rotation-key",
        keyPrefix: "sf_live_oldprefix",
        keyHash: "a".repeat(64),
        scopes: ["events:write"],
        expiresAt,
      });

      const result = await rotateProjectKey(database, {
        organizationId,
        keyId,
        actorUserId: userId,
        requestId: randomUUID(),
      });
      expect(result.kind).toBe("rotated");
      if (result.kind !== "rotated") return;
      expect(result.key.plaintext).toMatch(
        /^sf_live_[a-f0-9]{12}_[A-Za-z0-9_-]{40,60}$/,
      );
      expect(result.key.scopes).toEqual(["events:write"]);
      expect(result.key.expiresAt?.toISOString()).toBe(expiresAt.toISOString());

      const [oldKey] = await setupDatabase!.db
        .select({ revokedAt: apiKeys.revokedAt })
        .from(apiKeys)
        .where(eq(apiKeys.id, keyId));
      expect(oldKey?.revokedAt).not.toBeNull();

      const [newKey] = await setupDatabase!.db
        .select({
          organizationId: apiKeys.organizationId,
          projectId: apiKeys.projectId,
          name: apiKeys.name,
          scopes: apiKeys.scopes,
          keyHash: apiKeys.keyHash,
          expiresAt: apiKeys.expiresAt,
          revokedAt: apiKeys.revokedAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.id, result.key.id));
      expect(newKey?.organizationId).toBe(organizationId);
      expect(newKey?.projectId).toBe(projectId);
      expect(newKey?.name).toBe("rotation-key");
      expect(newKey?.scopes).toEqual(["events:write"]);
      expect(newKey?.expiresAt?.toISOString()).toBe(expiresAt.toISOString());
      expect(newKey?.revokedAt).toBeNull();
      expect(newKey?.keyHash).toBe(
        createHash("sha256").update(result.key.plaintext).digest("hex"),
      );

      const auditRows = await setupDatabase!.db
        .select({ action: auditLogs.action })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, organizationId),
            eq(auditLogs.resourceId, result.key.id),
          ),
        );
      expect(auditRows.map((row) => row.action)).toContain("api_key.rotated");
    } finally {
      await setupDatabase!.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await setupDatabase!.db.delete(users).where(eq(users.id, userId));
    }
  });

  it("rejects rotation for already revoked keys", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");

    const organizationId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID();
    const keyId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    try {
      await setupDatabase!.db.insert(users).values({
        id: userId,
        name: "Revoked Tester",
        email: `revoked-${suffix}@example.test`,
      });
      await setupDatabase!.db.insert(organizations).values({
        id: organizationId,
        name: "Revoked Org",
        slug: `revoked-org-${suffix}`,
      });
      await setupDatabase!.db.insert(projects).values({
        id: projectId,
        organizationId,
        name: "Revoked Project",
        slug: `revoked-project-${suffix}`,
      });
      await setupDatabase!.db.insert(apiKeys).values({
        id: keyId,
        organizationId,
        projectId,
        name: "revoked-key",
        keyPrefix: "sf_live_revoked",
        keyHash: "b".repeat(64),
        scopes: ["events:write"],
        revokedAt: new Date(),
      });

      const result = await rotateProjectKey(database, {
        organizationId,
        keyId,
        actorUserId: userId,
        requestId: randomUUID(),
      });
      expect(result).toEqual({ kind: "already_revoked" });
    } finally {
      await setupDatabase!.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await setupDatabase!.db.delete(users).where(eq(users.id, userId));
    }
  });

  it("rejects rotation for expired keys without creating a replacement", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");

    const organizationId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID();
    const keyId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    try {
      await setupDatabase!.db.insert(users).values({
        id: userId,
        name: "Expired Tester",
        email: `expired-${suffix}@example.test`,
      });
      await setupDatabase!.db.insert(organizations).values({
        id: organizationId,
        name: "Expired Org",
        slug: `expired-org-${suffix}`,
      });
      await setupDatabase!.db.insert(projects).values({
        id: projectId,
        organizationId,
        name: "Expired Project",
        slug: `expired-project-${suffix}`,
      });
      await setupDatabase!.db.insert(apiKeys).values({
        id: keyId,
        organizationId,
        projectId,
        name: "expired-key",
        keyPrefix: "sf_live_expired",
        keyHash: "c".repeat(64),
        scopes: ["events:write"],
        expiresAt: new Date(Date.now() - 60_000),
      });

      const beforeCount = await setupDatabase!.db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(eq(apiKeys.organizationId, organizationId));
      const result = await rotateProjectKey(database, {
        organizationId,
        keyId,
        actorUserId: userId,
        requestId: randomUUID(),
      });
      expect(result).toEqual({ kind: "expired" });
      const afterCount = await setupDatabase!.db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(eq(apiKeys.organizationId, organizationId));
      expect(afterCount).toHaveLength(beforeCount.length);
    } finally {
      await setupDatabase!.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await setupDatabase!.db.delete(users).where(eq(users.id, userId));
    }
  });

  it("returns missing for nonexistent keys and enforces tenant isolation", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");

    const organizationId = randomUUID();
    const otherOrganizationId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID();
    const keyId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    try {
      await setupDatabase!.db.insert(users).values({
        id: userId,
        name: "Tenant Tester",
        email: `tenant-${suffix}@example.test`,
      });
      await setupDatabase!.db.insert(organizations).values([
        { id: organizationId, name: "Tenant A", slug: `tenant-a-${suffix}` },
        {
          id: otherOrganizationId,
          name: "Tenant B",
          slug: `tenant-b-${suffix}`,
        },
      ]);
      await setupDatabase!.db.insert(projects).values({
        id: projectId,
        organizationId,
        name: "Tenant Project",
        slug: `tenant-project-${suffix}`,
      });
      await setupDatabase!.db.insert(apiKeys).values({
        id: keyId,
        organizationId,
        projectId,
        name: "tenant-key",
        keyPrefix: "sf_live_tenant",
        keyHash: "d".repeat(64),
        scopes: ["events:write"],
      });

      const missing = await rotateProjectKey(database, {
        organizationId,
        keyId: randomUUID(),
        actorUserId: userId,
        requestId: randomUUID(),
      });
      expect(missing).toEqual({ kind: "missing" });

      const crossTenant = await rotateProjectKey(database, {
        organizationId: otherOrganizationId,
        keyId,
        actorUserId: userId,
        requestId: randomUUID(),
      });
      expect(crossTenant).toEqual({ kind: "missing" });
    } finally {
      await setupDatabase!.db
        .delete(organizations)
        .where(
          inArray(organizations.id, [organizationId, otherOrganizationId]),
        );
      await setupDatabase!.db.delete(users).where(eq(users.id, userId));
    }
  });

  it("allows only one concurrent rotation to succeed", async () => {
    if (!connectionString) throw new Error("DATABASE_URL is required.");

    const organizationId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID();
    const keyId = randomUUID();
    const suffix = randomUUID().slice(0, 8);
    try {
      await setupDatabase!.db.insert(users).values({
        id: userId,
        name: "Concurrency Tester",
        email: `concurrency-${suffix}@example.test`,
      });
      await setupDatabase!.db.insert(organizations).values({
        id: organizationId,
        name: "Concurrency Org",
        slug: `concurrency-org-${suffix}`,
      });
      await setupDatabase!.db.insert(projects).values({
        id: projectId,
        organizationId,
        name: "Concurrency Project",
        slug: `concurrency-project-${suffix}`,
      });
      await setupDatabase!.db.insert(apiKeys).values({
        id: keyId,
        organizationId,
        projectId,
        name: "concurrency-key",
        keyPrefix: "sf_live_concurrency",
        keyHash: "e".repeat(64),
        scopes: ["events:write"],
      });

      const [first, second] = await Promise.all([
        rotateProjectKey(database, {
          organizationId,
          keyId,
          actorUserId: userId,
          requestId: randomUUID(),
        }),
        rotateProjectKey(database, {
          organizationId,
          keyId,
          actorUserId: userId,
          requestId: randomUUID(),
        }),
      ]);
      const results = [first, second];
      expect(
        results.filter((result) => result.kind === "rotated"),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.kind === "already_revoked"),
      ).toHaveLength(1);

      const rows = await setupDatabase!.db
        .select({ id: apiKeys.id, revokedAt: apiKeys.revokedAt })
        .from(apiKeys)
        .where(eq(apiKeys.organizationId, organizationId));
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.revokedAt === null)).toHaveLength(1);
    } finally {
      await setupDatabase!.db
        .delete(organizations)
        .where(eq(organizations.id, organizationId));
      await setupDatabase!.db.delete(users).where(eq(users.id, userId));
    }
  });
});
