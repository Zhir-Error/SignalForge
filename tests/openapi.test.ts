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
        "/v1/investigations/{investigationId}/cancel": expect.objectContaining({
          post: expect.any(Object),
        }),
        "/v1/investigations/{investigationId}/retry": expect.objectContaining({
          post: expect.any(Object),
        }),
        "/v1/incidents/{incidentId}/verification-runs": expect.objectContaining(
          { post: expect.any(Object) },
        ),
      }),
    });
  });

  it("documents the signed cursor parameters for both incident feeds", async () => {
    const text = await readFile(
      new URL("../docs/openapi.yaml", import.meta.url),
      "utf8",
    );
    const document = parse(text) as {
      paths: Record<
        string,
        {
          get?: {
            parameters?: Array<{ name?: string; in?: string }>;
            responses?: Record<string, unknown>;
          };
        }
      >;
      components: {
        schemas: Record<
          string,
          {
            properties?: Record<string, unknown>;
          }
        >;
      };
    };
    const incidentList =
      document.paths["/v1/projects/{projectId}/incidents"]?.get?.parameters;
    const incidentEvents =
      document.paths["/v1/incidents/{incidentId}/events"]?.get?.parameters;

    expect(incidentList).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "cursor", in: "query" }),
        expect.objectContaining({ name: "limit", in: "query" }),
        expect.objectContaining({ name: "status", in: "query" }),
        expect.objectContaining({ name: "severity", in: "query" }),
      ]),
    );
    expect(incidentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "cursor", in: "query" }),
        expect.objectContaining({ name: "limit", in: "query" }),
      ]),
    );
    expect(
      document.paths["/v1/projects/{projectId}/incidents"]?.get?.responses,
    ).toHaveProperty("400");
    expect(
      document.paths["/v1/incidents/{incidentId}/events"]?.get?.responses,
    ).toHaveProperty("400");
    expect(
      document.components.schemas.SuccessEnvelope?.properties?.page,
    ).toMatchObject({
      type: "object",
      required: ["hasMore", "nextCursor"],
      properties: {
        hasMore: { type: "boolean" },
        nextCursor: { type: ["string", "null"], maxLength: 2048 },
      },
    });
  });

  it("documents cancellation conflicts for investigations that have started", async () => {
    const text = await readFile(
      new URL("../docs/openapi.yaml", import.meta.url),
      "utf8",
    );
    const document = parse(text) as {
      paths: Record<string, { post?: { responses?: Record<string, unknown> } }>;
    };
    expect(
      document.paths["/v1/investigations/{investigationId}/cancel"]?.post
        ?.responses,
    ).toHaveProperty("409");
  });

  it("documents retry conflicts for investigations that are not eligible", async () => {
    const text = await readFile(
      new URL("../docs/openapi.yaml", import.meta.url),
      "utf8",
    );
    const document = parse(text) as {
      paths: Record<string, { post?: { responses?: Record<string, unknown> } }>;
    };
    expect(
      document.paths["/v1/investigations/{investigationId}/retry"]?.post
        ?.responses,
    ).toHaveProperty("409");
  });
});
