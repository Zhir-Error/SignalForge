import { afterEach, describe, expect, it, vi } from "vitest";
import { runRegisteredScenario } from "../apps/verification-runner/src/scenarios.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registered verification scenarios", () => {
  it("rejects unknown scenarios without making a request", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      runRegisteredScenario(
        "run-shell",
        "http://demo-service:4100",
        "runner-secret-that-is-long-enough",
      ),
    ).rejects.toThrow("SCENARIO_NOT_REGISTERED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("derives a reproduced controlled failure from the registered assertion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              status: 503,
              code: "DATABASE_CONNECTION_FAILED",
              message: "The isolated demo database is unavailable.",
            },
            requestId: "demo-request",
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const result = await runRegisteredScenario(
      "known-failure",
      "http://demo-service:4100",
      "runner-secret-that-is-long-enough",
    );
    expect(result).toMatchObject({ status: "passed", exitCode: 0 });
    expect(result.assertions[0]?.passed).toBe(true);
  });

  it("distinguishes an application assertion failure from runner infrastructure failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              status: 200,
              code: "CHECKOUT_READY",
              message: "Ready",
            },
            requestId: "demo-request",
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const failed = await runRegisteredScenario(
      "known-failure",
      "http://demo-service:4100",
      "runner-secret-that-is-long-enough",
    );
    expect(failed).toMatchObject({ status: "failed", exitCode: 1 });

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: URL, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => {
              reject(new DOMException("Aborted", "AbortError"));
            });
          }),
      ),
    );
    const timedOut = await runRegisteredScenario(
      "recovery-check",
      "http://demo-service:4100",
      "runner-secret-that-is-long-enough",
      10,
    );
    expect(timedOut).toMatchObject({ status: "timed_out", exitCode: null });
  });

  it("caps the sample service response before parsing it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("x".repeat(17_000), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-length": "17000",
          },
        }),
      ),
    );

    const result = await runRegisteredScenario(
      "recovery-check",
      "http://demo-service:4100",
      "runner-secret-that-is-long-enough",
    );
    expect(result).toMatchObject({ status: "error", exitCode: null });
  });
});
