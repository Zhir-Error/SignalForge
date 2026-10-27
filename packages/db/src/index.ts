import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;
export type TenantTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];

export function createDatabase(
  connectionString: string,
  poolOptions: Omit<PoolConfig, "connectionString"> = {},
) {
  const pool = new Pool({
    connectionString,
    max: 12,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...poolOptions,
  });
  const db = drizzle({ client: pool, schema });
  return {
    pool,
    db,
    async close(): Promise<void> {
      await pool.end();
    },
    async health(): Promise<boolean> {
      await pool.query("select 1");
      return true;
    },
    async withTenant<T>(
      userId: string,
      organizationId: string,
      action: (tx: TenantTransaction) => Promise<T>,
    ): Promise<T> {
      return db.transaction(async (tx) => {
        await tx.execute(
          sql`select set_config('app.user_id', ${userId}, true), set_config('app.organization_id', ${organizationId}, true)`,
        );
        return action(tx);
      });
    },
  };
}

export * from "./schema.js";
