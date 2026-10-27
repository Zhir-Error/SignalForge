import type { Redis } from "ioredis";

export interface IngestionRateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

interface CounterStore {
  increment(
    keys: [string, string],
    now: number,
    ttlMs: number,
  ): Promise<[number, number]>;
}

export class InMemoryCounterStore implements CounterStore {
  private readonly counters = new Map<
    string,
    { count: number; expiresAt: number }
  >();
  private nextCleanupAt = 0;

  async increment(
    keys: [string, string],
    now: number,
    ttlMs: number,
  ): Promise<[number, number]> {
    if (now >= this.nextCleanupAt) {
      for (const [key, counter] of this.counters) {
        if (counter.expiresAt <= now) this.counters.delete(key);
      }
      this.nextCleanupAt = now + ttlMs;
    }

    return keys.map((key) => {
      const current = this.counters.get(key);
      const counter =
        current && current.expiresAt > now
          ? current
          : { count: 0, expiresAt: now + ttlMs };
      counter.count += 1;
      this.counters.set(key, counter);
      return counter.count;
    }) as [number, number];
  }
}

export class RedisCounterStore implements CounterStore {
  constructor(private readonly redis: Redis) {}

  async increment(
    keys: [string, string],
    _now: number,
    ttlMs: number,
  ): Promise<[number, number]> {
    const result = await this.redis.eval(
      `
        local key_count = redis.call('INCR', KEYS[1])
        if key_count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
        local organization_count = redis.call('INCR', KEYS[2])
        if organization_count == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[1]) end
        return { key_count, organization_count }
      `,
      2,
      keys[0],
      keys[1],
      String(ttlMs),
    );
    if (
      !Array.isArray(result) ||
      result.length !== 2 ||
      !Number.isFinite(Number(result[0])) ||
      !Number.isFinite(Number(result[1]))
    )
      throw new Error("RATE_LIMIT_STORE_INVALID_RESPONSE");
    return [Number(result[0]), Number(result[1])];
  }
}

export class IngestionRateLimiter {
  constructor(private readonly store: CounterStore) {}

  async consume(input: {
    organizationId: string;
    apiKeyId: string;
    perKeyLimit: number;
    perOrganizationLimit: number;
    now?: number;
  }): Promise<IngestionRateLimitResult> {
    const now = input.now ?? Date.now();
    const windowMs = 60_000;
    const windowNumber = Math.floor(now / windowMs);
    const windowReset = (windowNumber + 1) * windowMs;
    const bucket = `signalforge:ingestion-rate:v1:${windowNumber}`;
    const keys: [string, string] = [
      `${bucket}:key:${input.apiKeyId}`,
      `${bucket}:organization:${input.organizationId}`,
    ];
    const [keyCount, organizationCount] = await this.store.increment(
      keys,
      now,
      windowReset - now,
    );
    return {
      allowed:
        keyCount <= input.perKeyLimit &&
        organizationCount <= input.perOrganizationLimit,
      retryAfterMs: Math.max(1, windowReset - now),
    };
  }
}
