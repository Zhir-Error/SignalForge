import { z } from "zod";
import { classifyVerificationExit } from "@signalforge/domain";

export type ScenarioKey = "known-failure" | "recovery-check";
export interface AssertionResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}
export interface ScenarioResult {
  status: "passed" | "failed" | "error" | "timed_out";
  summary: string;
  assertions: AssertionResult[];
  exitCode: number | null;
}

/** Only fixed, versioned demo checks are executable. No input becomes a command or file path. */
export const registeredScenarios: Readonly<
  Record<ScenarioKey, { version: string; title: string }>
> = {
  "known-failure": {
    version: "1",
    title: "Known checkout failure is reproducible",
  },
  "recovery-check": {
    version: "1",
    title: "Corrected checkout configuration passes",
  },
};

export const scenarioKeySchema = z.enum(["known-failure", "recovery-check"]);
const scenarioResponseSchema = z
  .object({
    data: z
      .object({
        status: z.number().int().min(100).max(599),
        code: z.string().min(1).max(80),
        message: z.string().max(500),
      })
      .strict(),
    requestId: z.string().min(1).max(128),
  })
  .strict();

async function readJsonWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error("SCENARIO_RESPONSE_TOO_LARGE");
  }
  if (!response.body) throw new Error("SCENARIO_RESPONSE_INVALID");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error("SCENARIO_RESPONSE_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new Error("SCENARIO_RESPONSE_INVALID");
  }
}

export async function runRegisteredScenario(
  key: string,
  demoServiceUrl: string,
  scenarioSecret: string,
  timeoutMs = 60_000,
): Promise<ScenarioResult> {
  const parsedKey = scenarioKeySchema.safeParse(key);
  if (!parsedKey.success) throw new Error("SCENARIO_NOT_REGISTERED");
  const scenarioKey = parsedKey.data;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const assertions: AssertionResult[] = [];
  try {
    const endpoint = new URL(
      `/internal/scenarios/${scenarioKey}`,
      demoServiceUrl,
    );
    const response = await fetch(endpoint, {
      method: "GET",
      headers: { authorization: `Bearer ${scenarioSecret}` },
      redirect: "error",
      signal: controller.signal,
    });
    const raw = await readJsonWithinLimit(response, 16_384);
    const parsedResponse = scenarioResponseSchema.safeParse(raw);
    if (!parsedResponse.success)
      return {
        status: "error",
        summary: "The sample service returned an invalid scenario result.",
        assertions,
        exitCode: null,
      };

    const expected =
      scenarioKey === "known-failure"
        ? { status: 503, code: "DATABASE_CONNECTION_FAILED" }
        : { status: 200, code: "CHECKOUT_READY" };
    const outcome = parsedResponse.data.data;
    const passed =
      response.status === expected.status &&
      outcome.status === expected.status &&
      outcome.code === expected.code;
    assertions.push({
      name:
        scenarioKey === "known-failure"
          ? "sample checkout reports the controlled database failure"
          : "sample checkout can query the configured database",
      passed,
      expected: `${expected.status} ${expected.code}`,
      actual: `${response.status} ${outcome.status} ${outcome.code}`,
    });
    const exitCode = assertions.every((assertion) => assertion.passed) ? 0 : 1;
    return {
      status: classifyVerificationExit(
        exitCode,
        controller.signal.aborted,
        false,
      ),
      summary: `${assertions.filter((assertion) => assertion.passed).length}/${assertions.length} assertions passed.`,
      assertions,
      exitCode,
    };
  } catch {
    return {
      status: controller.signal.aborted ? "timed_out" : "error",
      summary: controller.signal.aborted
        ? "Scenario exceeded its time limit."
        : "The sample service did not return a reliable scenario result.",
      assertions,
      exitCode: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}
