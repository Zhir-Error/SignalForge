import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("local demo infrastructure", () => {
  it("keeps verification on the isolated demo database and authenticated service", async () => {
    const source = await readFile(
      new URL("../docker-compose.yml", import.meta.url),
      "utf8",
    );
    const compose: unknown = parse(source);

    expect(compose).toMatchObject({
      services: {
        "demo-postgres": { image: "postgres:18-alpine" },
        "demo-service": {
          environment: {
            DEMO_DATABASE_URL: expect.stringContaining(
              "@demo-postgres:5432/signalforge_demo",
            ),
            VERIFICATION_RUNNER_SECRET: expect.any(String),
          },
          networks: ["default", "verification"],
        },
        "verification-runner": {
          command: ["node", "dist/index.js"],
          environment: {
            DEMO_SERVICE_URL: "http://demo-service:4100",
            VERIFICATION_RUNNER_SECRET: expect.any(String),
          },
          read_only: true,
          cap_drop: ["ALL"],
          security_opt: ["no-new-privileges:true"],
          mem_limit: "128m",
          cpus: 0.5,
          pids_limit: 64,
          networks: ["verification"],
        },
        worker: { networks: ["default", "verification"] },
      },
      networks: { verification: { internal: true } },
    });

    expect(
      (compose as { services: Record<string, { tmpfs?: string[] }> }).services[
        "verification-runner"
      ]?.tmpfs?.[0],
    ).toContain("noexec,nosuid");
  });
});
