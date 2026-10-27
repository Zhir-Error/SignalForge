import type { Pool } from "pg";
import { isDeepStrictEqual } from "node:util";

export type OutboxDispatch = {
  outboxId: string;
  topic: string;
  payload: Record<string, unknown>;
};

type OutboxDispatchRow = {
  organization_id: string;
  topic: string;
  payload: Record<string, unknown>;
  status: string;
};

/**
 * Authorize a queued job against its durable PostgreSQL outbox record.
 * Returns false only when another delivery already completed the same event.
 */
export async function authorizeOutboxDispatch(
  pool: Pick<Pool, "query">,
  job: OutboxDispatch,
): Promise<boolean> {
  const result = await pool.query<OutboxDispatchRow>(
    "SELECT organization_id, topic, payload, status FROM outbox WHERE id=$1",
    [job.outboxId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("OUTBOX_DISPATCH_NOT_FOUND");

  if (
    row.topic !== job.topic ||
    !isDeepStrictEqual(row.payload, job.payload) ||
    (typeof job.payload.organizationId === "string" &&
      job.payload.organizationId.toLowerCase() !==
        row.organization_id.toLowerCase())
  )
    throw new Error("OUTBOX_DISPATCH_MISMATCH");

  if (row.status === "delivered") return false;
  if (row.status !== "processing")
    throw new Error("OUTBOX_DISPATCH_NOT_CLAIMED");
  return true;
}
