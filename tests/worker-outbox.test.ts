import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { authorizeOutboxDispatch } from "../apps/worker/src/outbox-dispatch.js";

const organizationId = "11111111-1111-4111-8111-111111111111";
const outboxId = "22222222-2222-4222-8222-222222222222";
const payload = {
  investigationId: "33333333-3333-4333-8333-333333333333",
  incidentId: "44444444-4444-4444-8444-444444444444",
  projectId: "55555555-5555-4555-8555-555555555555",
  organizationId,
};

function poolWith(row: Record<string, unknown> | undefined) {
  const query = vi.fn().mockResolvedValue({ rows: row ? [row] : [] });
  return { pool: { query } as unknown as Pick<Pool, "query">, query };
}

describe("queued worker outbox authorization", () => {
  it("accepts a claimed job only when it matches the durable row", async () => {
    const { pool } = poolWith({
      organization_id: organizationId,
      topic: "investigation.run",
      payload,
      status: "processing",
    });

    await expect(
      authorizeOutboxDispatch(pool, {
        outboxId,
        topic: "investigation.run",
        payload: { ...payload },
      }),
    ).resolves.toBe(true);
  });

  it("rejects a forged topic or payload before processing", async () => {
    const { pool } = poolWith({
      organization_id: organizationId,
      topic: "investigation.run",
      payload,
      status: "processing",
    });

    await expect(
      authorizeOutboxDispatch(pool, {
        outboxId,
        topic: "verification.run",
        payload: { ...payload },
      }),
    ).rejects.toThrow("OUTBOX_DISPATCH_MISMATCH");
    await expect(
      authorizeOutboxDispatch(pool, {
        outboxId,
        topic: "investigation.run",
        payload: {
          ...payload,
          investigationId: "66666666-6666-4666-8666-666666666666",
        },
      }),
    ).rejects.toThrow("OUTBOX_DISPATCH_MISMATCH");
  });

  it("rejects payload tenant ids that do not match the outbox tenant", async () => {
    const { pool } = poolWith({
      organization_id: organizationId,
      topic: "investigation.run",
      payload,
      status: "processing",
    });

    await expect(
      authorizeOutboxDispatch(pool, {
        outboxId,
        topic: "investigation.run",
        payload: {
          ...payload,
          organizationId: "77777777-7777-4777-8777-777777777777",
        },
      }),
    ).rejects.toThrow("OUTBOX_DISPATCH_MISMATCH");
  });

  it("acknowledges an identical duplicate without processing it again", async () => {
    const { pool } = poolWith({
      organization_id: organizationId,
      topic: "investigation.run",
      payload,
      status: "delivered",
    });

    await expect(
      authorizeOutboxDispatch(pool, {
        outboxId,
        topic: "investigation.run",
        payload: { ...payload },
      }),
    ).resolves.toBe(false);
  });

  it("rejects stale jobs for rows that are no longer claimed", async () => {
    const { pool } = poolWith({
      organization_id: organizationId,
      topic: "investigation.run",
      payload,
      status: "pending",
    });

    await expect(
      authorizeOutboxDispatch(pool, {
        outboxId,
        topic: "investigation.run",
        payload: { ...payload },
      }),
    ).rejects.toThrow("OUTBOX_DISPATCH_NOT_CLAIMED");
  });

  it("rejects jobs whose outbox row no longer exists", async () => {
    const { pool } = poolWith(undefined);

    await expect(
      authorizeOutboxDispatch(pool, {
        outboxId,
        topic: "investigation.run",
        payload: { ...payload },
      }),
    ).rejects.toThrow("OUTBOX_DISPATCH_NOT_FOUND");
  });
});
