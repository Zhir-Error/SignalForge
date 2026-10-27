import { describe, expect, it } from "vitest";
import {
  InMemoryCounterStore,
  IngestionRateLimiter,
} from "../apps/api/src/ingestion-rate-limit.js";

describe("ingestion rate limits", () => {
  it("enforces independent API-key and organization limits", async () => {
    const limiter = new IngestionRateLimiter(new InMemoryCounterStore());
    const shared = {
      organizationId: "organization-a",
      perKeyLimit: 2,
      perOrganizationLimit: 5,
      now: 120_000,
    };

    expect(
      await limiter.consume({ ...shared, apiKeyId: "key-a" }),
    ).toMatchObject({ allowed: true });
    expect(
      await limiter.consume({ ...shared, apiKeyId: "key-a" }),
    ).toMatchObject({ allowed: true });
    expect(
      await limiter.consume({ ...shared, apiKeyId: "key-a" }),
    ).toMatchObject({ allowed: false });

    expect(
      await limiter.consume({ ...shared, apiKeyId: "key-b" }),
    ).toMatchObject({ allowed: true });
    expect(
      await limiter.consume({ ...shared, apiKeyId: "key-c" }),
    ).toMatchObject({ allowed: true });
    expect(
      await limiter.consume({ ...shared, apiKeyId: "key-d" }),
    ).toMatchObject({ allowed: false });
  });

  it("isolates organizations and resets counters at the next fixed window", async () => {
    const limiter = new IngestionRateLimiter(new InMemoryCounterStore());
    const limit = {
      apiKeyId: "key-a",
      perKeyLimit: 1,
      perOrganizationLimit: 1,
    };

    expect(
      await limiter.consume({
        ...limit,
        organizationId: "organization-a",
        now: 59_999,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await limiter.consume({
        ...limit,
        apiKeyId: "key-b",
        organizationId: "organization-b",
        now: 59_999,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await limiter.consume({
        ...limit,
        organizationId: "organization-a",
        now: 60_000,
      }),
    ).toMatchObject({ allowed: true });
  });
});
