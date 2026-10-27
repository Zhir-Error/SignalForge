import { describe, expect, it } from "vitest";
import { evaluateCheckoutConfiguration } from "../apps/demo-service/src/scenarios.js";

describe("demo checkout database configuration", () => {
  it("accepts a PostgreSQL URL with a database name", () => {
    expect(
      evaluateCheckoutConfiguration(
        "postgresql://demo:local-only@localhost:5433/signalforge_demo",
      ),
    ).toMatchObject({
      status: 200,
      code: "CHECKOUT_READY",
    });
  });

  it.each([undefined, "", "not-a-url", "https://example.test/db"])(
    "rejects invalid database configuration: %s",
    (databaseUrl) => {
      expect(evaluateCheckoutConfiguration(databaseUrl)).toMatchObject({
        status: 503,
        code: "DATABASE_CONFIGURATION_MISSING",
      });
    },
  );
});
