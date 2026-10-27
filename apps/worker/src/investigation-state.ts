import { and, eq, inArray } from "drizzle-orm";
import { investigations } from "@signalforge/db";
import type { TenantTransaction } from "@signalforge/db";

export async function markInvestigationRunning(
  tx: TenantTransaction,
  input: { organizationId: string; investigationId: string },
  startedAt = new Date(),
): Promise<boolean> {
  const updated = await tx
    .update(investigations)
    .set({
      status: "running",
      startedAt,
      errorCode: null,
      updatedAt: startedAt,
    })
    .where(
      and(
        eq(investigations.id, input.investigationId),
        eq(investigations.organizationId, input.organizationId),
        inArray(investigations.status, ["queued", "running"]),
      ),
    )
    .returning({ id: investigations.id });
  return updated.length > 0;
}
