import type { Pool } from "pg";

const OUTBOX_LEASE_MS = 120_000;

type OutboxJob = {
  id: string;
  topic: string;
  payload: Record<string, unknown>;
};

type QueueJob = {
  getState(): Promise<string>;
};

export type OutboxQueueInspector = {
  getJob(id: string): Promise<QueueJob | undefined>;
};

export type FinalFailureHandler = (
  topic: string,
  payload: Record<string, unknown>,
) => Promise<void>;

export async function heartbeatOutbox(pool: Pool, id: string): Promise<void> {
  await pool.query(
    "UPDATE outbox SET locked_at=now() WHERE id=$1 AND status='processing'",
    [id],
  );
}

export async function markOutboxDelivered(
  pool: Pool,
  id: string,
): Promise<void> {
  const result = await pool.query(
    "UPDATE outbox SET status='delivered', delivered_at=now(), locked_at=NULL, last_error_code=NULL WHERE id=$1 AND status='processing'",
    [id],
  );
  if (result.rowCount !== 1) throw new Error("OUTBOX_LEASE_LOST");
}

export async function deferOutboxDispatch(
  pool: Pool,
  id: string,
  attempts: number,
): Promise<void> {
  const delayMs = Math.min(
    60_000,
    1_000 * 2 ** Math.max(0, Math.min(attempts - 1, 6)),
  );
  await pool.query(
    "UPDATE outbox SET status='pending', available_at=now() + ($2 * interval '1 millisecond'), locked_at=NULL, last_error_code='QUEUE_DISPATCH_RETRYING' WHERE id=$1 AND status='processing'",
    [id, delayMs],
  );
}

export async function reconcileStaleOutbox(
  pool: Pool,
  queue: OutboxQueueInspector | null,
  markFinalFailure: FinalFailureHandler,
): Promise<void> {
  const staleBefore = new Date(Date.now() - OUTBOX_LEASE_MS);
  const result = await pool.query<OutboxJob>(
    `SELECT id, topic, payload
       FROM outbox
      WHERE status='processing' AND locked_at < $1
      ORDER BY locked_at
      LIMIT 100`,
    [staleBefore],
  );

  for (const item of result.rows) {
    if (!queue) {
      await pool.query(
        "UPDATE outbox SET status='pending', available_at=now(), locked_at=NULL WHERE id=$1 AND status='processing' AND locked_at < $2",
        [item.id, staleBefore],
      );
      continue;
    }

    const job = await queue.getJob(item.id);
    if (!job) {
      await pool.query(
        "UPDATE outbox SET status='pending', available_at=now(), locked_at=NULL WHERE id=$1 AND status='processing' AND locked_at < $2",
        [item.id, staleBefore],
      );
      continue;
    }

    const state = await job.getState();
    if (state === "completed") {
      await pool.query(
        "UPDATE outbox SET status='delivered', delivered_at=now(), locked_at=NULL, last_error_code=NULL WHERE id=$1 AND status='processing' AND locked_at < $2",
        [item.id, staleBefore],
      );
    } else if (state === "failed") {
      await markFinalFailure(item.topic, item.payload);
      const updated = await pool.query(
        "UPDATE outbox SET status='failed', last_error_code='JOB_RETRIES_EXHAUSTED', locked_at=NULL WHERE id=$1 AND status='processing' AND locked_at < $2",
        [item.id, staleBefore],
      );
      if (updated.rowCount !== 1) continue;
    } else {
      // A queued, delayed, or active BullMQ job still owns this durable outbox row.
      await pool.query(
        "UPDATE outbox SET locked_at=now() WHERE id=$1 AND status='processing' AND locked_at < $2",
        [item.id, staleBefore],
      );
    }
  }
}
