import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createInvestigationProvider,
  OpenAIResponsesProvider,
} from "../packages/ai-investigator/src/index.js";

const context = {
  investigationId: "test",
  incident: {
    id: "incident",
    title: "Database failure",
    severity: "error",
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    fingerprint: "fingerprint",
  },
  evidence: [],
  deploymentContext: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("investigation provider failures", () => {
  it("does not silently fall back when OpenAI credentials are missing", () => {
    expect(() =>
      createInvestigationProvider({ provider: "openai", model: "gpt-test" }),
    ).toThrow("AI_PROVIDER_CONFIGURATION_INVALID");
  });

  it("reports rate limits distinctly and never returns mock analysis", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 429 })),
    );
    const provider = new OpenAIResponsesProvider("test-key", "gpt-test");

    await expect(
      provider.investigate(context, new AbortController().signal),
    ).rejects.toThrow("PROVIDER_RATE_LIMITED");
  });

  it("reports unavailable providers without inventing a result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 503 })),
    );
    const provider = new OpenAIResponsesProvider("test-key", "gpt-test");

    await expect(
      provider.investigate(context, new AbortController().signal),
    ).rejects.toThrow("PROVIDER_REQUEST_FAILED");
  });

  it("returns validated provider output and bounded token usage metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            model: "gpt-test",
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      summary: "The evidence records a database failure.",
                      hypotheses: [],
                      limitations: [
                        "The result is based on synthetic evidence.",
                      ],
                    }),
                  },
                ],
              },
            ],
            usage: { input_tokens: 64, output_tokens: 12 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const provider = new OpenAIResponsesProvider("test-key", "gpt-test");

    await expect(
      provider.investigate(context, new AbortController().signal),
    ).resolves.toMatchObject({
      provider: "openai",
      model: "gpt-test",
      inputTokens: 64,
      outputTokens: 12,
      output: { hypotheses: [] },
    });
  });

  it("discards non-integer or out-of-range provider token counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            output: [
              {
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      summary: "No hypotheses are supported.",
                      hypotheses: [],
                      limitations: [],
                    }),
                  },
                ],
              },
            ],
            usage: { input_tokens: 1.5, output_tokens: -1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const provider = new OpenAIResponsesProvider("test-key", "gpt-test");

    await expect(
      provider.investigate(context, new AbortController().signal),
    ).resolves.toMatchObject({ inputTokens: null, outputTokens: null });
  });
});
