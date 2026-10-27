import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

describe("OpenAPI contract", () => {
  it("parses and covers the core authenticated and ingestion workflows", async () => {
    const text = await readFile(
      new URL("../docs/openapi.yaml", import.meta.url),
      "utf8",
    );
    const document: unknown = parse(text);
    expect(document).toMatchObject({
      openapi: "3.1.0",
      info: { title: "SignalForge API" },
      paths: expect.objectContaining({
        "/v1/onboarding": expect.objectContaining({ post: expect.any(Object) }),
        "/v1/ingest/events": expect.objectContaining({
          post: expect.any(Object),
        }),
        "/v1/projects/{projectId}/incidents": expect.objectContaining({
          get: expect.any(Object),
        }),
        "/v1/incidents/{incidentId}/investigations": expect.objectContaining({
          post: expect.any(Object),
        }),
        "/v1/incidents/{incidentId}/verification-runs": expect.objectContaining(
          { post: expect.any(Object) },
        ),
      }),
    });
  });
});
