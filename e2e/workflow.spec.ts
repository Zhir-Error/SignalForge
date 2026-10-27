import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

test("a user can complete the incident workflow without cross-tenant access", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const email = `signalforge-e2e-${randomUUID()}@example.test`;
  const invitedEmail = `signalforge-viewer-${randomUUID()}@example.test`;
  const slug = `e2e-${randomUUID().slice(0, 8)}`;

  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "When production gets loud, find the signal in it.",
    }),
  ).toBeVisible();
  const unauthenticatedStream = await page.request.get(
    `http://localhost:4000/v1/projects/${randomUUID()}/stream?organizationId=${randomUUID()}`,
  );
  expect(
    unauthenticatedStream.status(),
    await unauthenticatedStream.text(),
  ).toBe(401);
  await page.getByRole("link", { name: "Enter the workspace" }).click();
  await page
    .getByRole("button", { name: "New to SignalForge? Create an account" })
    .click();
  await page.getByLabel("Name").fill("SignalForge Browser Test");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("browser-test-password-2026");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(
    page.getByRole("heading", { name: "Create your workspace" }),
  ).toBeVisible();
  await page.getByLabel("Organization name").fill("Browser Test Workspace");
  await page.getByLabel("Project name").fill("Browser Test Checkout");
  await page.getByLabel("Project slug").fill(slug);
  await page.getByRole("button", { name: "Create workspace" }).click();

  const keyNotice = page.getByText(
    "Workspace created. Copy the initial key now; it will not be shown again.",
  );
  await expect(keyNotice).toBeVisible();

  const organizationResponse = await page.request.get(
    "http://localhost:4000/v1/me/organizations",
  );
  expect(organizationResponse.status()).toBe(200);
  const organizationPayload: unknown = await organizationResponse.json();
  if (
    !isObject(organizationPayload) ||
    !Array.isArray(organizationPayload.data) ||
    !isObject(organizationPayload.data[0]) ||
    typeof organizationPayload.data[0].id !== "string"
  )
    throw new Error("The new organization was not returned to its owner.");
  const createdOrganizationId = organizationPayload.data[0].id;
  const ownerProjectsResponse = await page.request.get(
    `http://localhost:4000/v1/projects?organizationId=${createdOrganizationId}`,
  );
  expect(ownerProjectsResponse.status()).toBe(200);
  const ownerProjectsPayload: unknown = await ownerProjectsResponse.json();
  if (
    !isObject(ownerProjectsPayload) ||
    !Array.isArray(ownerProjectsPayload.data) ||
    !isObject(ownerProjectsPayload.data[0]) ||
    typeof ownerProjectsPayload.data[0].id !== "string"
  )
    throw new Error("The new project was not returned to its owner.");
  const ownerProjectId = ownerProjectsPayload.data[0].id;
  const ownerMembersResponse = await page.request.get(
    `http://localhost:4000/v1/organizations/${createdOrganizationId}/members`,
  );
  expect(ownerMembersResponse.status()).toBe(200);
  const ownerMembersPayload: unknown = await ownerMembersResponse.json();
  if (
    !isObject(ownerMembersPayload) ||
    !Array.isArray(ownerMembersPayload.data)
  )
    throw new Error("The organization member list was not returned.");
  const owner = ownerMembersPayload.data.find(
    (item) => isObject(item) && item.email === email,
  );
  if (!isObject(owner) || typeof owner.userId !== "string")
    throw new Error("The signed-in owner was missing from the member list.");
  const ownerUserId = owner.userId;
  const lastOwnerPath = `http://localhost:4000/v1/organizations/${createdOrganizationId}/members/${owner.userId}`;
  const demoteLastOwner = await page.request.patch(lastOwnerPath, {
    data: { role: "viewer" },
  });
  expect(demoteLastOwner.status()).toBe(409);
  expect(await demoteLastOwner.json()).toMatchObject({
    error: { code: "LAST_OWNER" },
  });
  const removeLastOwner = await page.request.delete(lastOwnerPath);
  expect(removeLastOwner.status()).toBe(409);
  expect(await removeLastOwner.json()).toMatchObject({
    error: { code: "LAST_OWNER" },
  });

  await page.getByRole("button", { name: "Resources" }).click();
  await page.getByLabel("Name").nth(0).fill("Production");
  await page.getByLabel("Slug").fill("production");
  await page.getByRole("button", { name: "Add environment" }).click();
  await expect(page.getByText("production", { exact: true })).toBeVisible();

  await page.getByLabel("Name").nth(1).fill("Billing API");
  await page.getByLabel("Service key").fill("billing-api");
  await page.getByRole("button", { name: "Add service" }).click();
  await expect(page.getByText("billing-api", { exact: true })).toBeVisible();

  await page.getByLabel("Environment").selectOption({ label: "Production" });
  await page.getByLabel("Version").fill("e2e-v1");
  await page.getByRole("button", { name: "Record deployment" }).click();
  await expect(page.getByText("e2e-v1", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "API keys" }).click();
  await page.getByPlaceholder("Key name").fill("E2E telemetry key");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(
    page.getByText(
      "Key created. Copy it now; only its prefix is stored for display.",
    ),
  ).toBeVisible();
  const projectKey = await page
    .locator("code")
    .filter({ hasText: /^sf_live_/ })
    .innerText();
  const ownerApiKeysResponse = await page.request.get(
    `http://localhost:4000/v1/projects/${ownerProjectId}/api-keys`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  expect(ownerApiKeysResponse.status()).toBe(200);
  const ownerApiKeysPayload: unknown = await ownerApiKeysResponse.json();
  if (
    !isObject(ownerApiKeysPayload) ||
    !Array.isArray(ownerApiKeysPayload.data) ||
    !isObject(ownerApiKeysPayload.data[0]) ||
    typeof ownerApiKeysPayload.data[0].id !== "string"
  )
    throw new Error("The initial project key was not returned to its owner.");
  const ownerApiKeyId = ownerApiKeysPayload.data[0].id;
  const ingestionUrl = "http://localhost:4000/v1/ingest/events";
  const ingestionHeaders = {
    Authorization: `Bearer ${projectKey}`,
    "Idempotency-Key": `e2e-${randomUUID()}`,
  };
  const xssMarker = `E2E untrusted log ${randomUUID()}`;
  const untrustedLogMessage = `<img src=x onerror="window.signalForgeXss=true">${xssMarker}<script>window.signalForgeXss=true</script>`;
  const telemetryEvent = {
    eventType: "error",
    occurredAt: new Date().toISOString(),
    service: "billing-api",
    environment: "production",
    severity: "error",
    message: untrustedLogMessage,
    attributes: { source: "playwright" },
  };
  const malformedIngestion = await page.request.post(ingestionUrl, {
    headers: ingestionHeaders,
    data: { ...telemetryEvent, unexpected: true },
  });
  expect(malformedIngestion.status()).toBe(400);
  const firstIngestion = await page.request.post(ingestionUrl, {
    headers: ingestionHeaders,
    data: telemetryEvent,
  });
  expect(firstIngestion.status()).toBe(200);
  expect(await firstIngestion.json()).toMatchObject({
    data: { accepted: 1, duplicates: 0 },
  });
  const replayedIngestion = await page.request.post(ingestionUrl, {
    headers: ingestionHeaders,
    data: telemetryEvent,
  });
  expect(replayedIngestion.status()).toBe(200);
  expect(await replayedIngestion.json()).toMatchObject({
    data: { accepted: 0, duplicates: 1 },
  });
  const conflictingReplay = await page.request.post(ingestionUrl, {
    headers: ingestionHeaders,
    data: { ...telemetryEvent, message: "Different payload" },
  });
  expect(conflictingReplay.status()).toBe(409);

  const equalTimestamp = new Date().toISOString();
  const equalTimestampMessage = `Equal timestamp cursor fixture ${randomUUID()}`;
  const equalTimestampIngestion = await page.request.post(ingestionUrl, {
    headers: {
      Authorization: `Bearer ${projectKey}`,
      "Idempotency-Key": `e2e-equal-timestamp-${randomUUID()}`,
    },
    data: {
      events: Array.from({ length: 3 }, () => ({
        ...telemetryEvent,
        occurredAt: equalTimestamp,
        message: equalTimestampMessage,
      })),
    },
  });
  expect(equalTimestampIngestion.status()).toBe(200);
  const equalTimestampIngestionPayload: unknown =
    await equalTimestampIngestion.json();
  if (
    !isObject(equalTimestampIngestionPayload) ||
    !isObject(equalTimestampIngestionPayload.data) ||
    equalTimestampIngestionPayload.data.accepted !== 3 ||
    !Array.isArray(equalTimestampIngestionPayload.data.eventIds) ||
    equalTimestampIngestionPayload.data.eventIds.length !== 3 ||
    !equalTimestampIngestionPayload.data.eventIds.every(
      (eventId) => typeof eventId === "string",
    )
  )
    throw new Error("The equal-timestamp events were not accepted.");
  const expectedEqualTimestampEventIds = equalTimestampIngestionPayload.data
    .eventIds as string[];

  let equalTimestampIncidentId: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `http://localhost:4000/v1/projects/${ownerProjectId}/incidents?limit=50`,
          { headers: { "x-organization-id": createdOrganizationId } },
        );
        if (response.status() !== 200) return false;
        const payload: unknown = await response.json();
        if (!isObject(payload) || !Array.isArray(payload.data)) return false;
        const incident = payload.data.find(
          (candidate) =>
            isObject(candidate) &&
            candidate.title === equalTimestampMessage &&
            candidate.eventCount === 3,
        );
        if (!isObject(incident) || typeof incident.id !== "string")
          return false;
        equalTimestampIncidentId = incident.id;
        return true;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  if (!equalTimestampIncidentId)
    throw new Error("The equal-timestamp incident was not correlated.");

  const equalTimestampEventIds: string[] = [];
  let equalTimestampCursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 3; pageNumber += 1) {
    const query = equalTimestampCursor
      ? `?limit=1&cursor=${encodeURIComponent(equalTimestampCursor)}`
      : "?limit=1";
    const response = await page.request.get(
      `http://localhost:4000/v1/incidents/${equalTimestampIncidentId}/events${query}`,
      { headers: { "x-organization-id": createdOrganizationId } },
    );
    expect(response.status()).toBe(200);
    const payload: unknown = await response.json();
    if (
      !isObject(payload) ||
      !Array.isArray(payload.data) ||
      !isObject(payload.data[0]) ||
      typeof payload.data[0].eventId !== "string" ||
      payload.data[0].occurredAt !== equalTimestamp ||
      !isObject(payload.page)
    )
      throw new Error("An equal-timestamp event page was malformed.");
    equalTimestampEventIds.push(payload.data[0].eventId);
    equalTimestampCursor =
      typeof payload.page.nextCursor === "string"
        ? payload.page.nextCursor
        : null;
    expect(payload.page.hasMore).toBe(pageNumber < 2);
  }
  expect(new Set(equalTimestampEventIds).size).toBe(3);
  expect(equalTimestampEventIds.sort()).toEqual(
    [...expectedEqualTimestampEventIds].sort(),
  );

  const revokeButtons = page.getByRole("button", { name: "Revoke key" });
  await expect(revokeButtons).toHaveCount(2);
  await revokeButtons.first().click();
  await expect(revokeButtons).toHaveCount(1);
  const revokedKeyRequest = await page.request.post(ingestionUrl, {
    headers: ingestionHeaders,
    data: telemetryEvent,
  });
  expect(revokedKeyRequest.status()).toBe(401);
  const ingestionBurst = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    ingestionBurst.push(
      await page.request.post(ingestionUrl, {
        headers: ingestionHeaders,
        data: telemetryEvent,
      }),
    );
  }
  const rateLimitedIngestion = ingestionBurst.find(
    (response) => response.status() === 429,
  );
  expect(
    rateLimitedIngestion,
    JSON.stringify(
      ingestionBurst.map((response) => ({
        status: response.status(),
        limit: response.headers()["x-ratelimit-limit"],
        remaining: response.headers()["x-ratelimit-remaining"],
      })),
    ),
  ).toBeDefined();
  expect(await rateLimitedIngestion?.json()).toMatchObject({
    error: { code: "RATE_LIMITED" },
  });

  await page.getByRole("button", { name: "Incidents" }).click();
  const untrustedLogIncident = page
    .getByRole("button", { name: new RegExp(xssMarker) })
    .first();
  await expect(untrustedLogIncident).toBeVisible({ timeout: 10_000 });
  await untrustedLogIncident.click();
  await expect(
    page.getByText(untrustedLogMessage, { exact: true }).last(),
  ).toBeVisible();
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as Window & { signalForgeXss?: boolean }).signalForgeXss,
    ),
  ).toBeUndefined();

  await page.getByRole("button", { name: "Audit" }).click();
  await expect(
    page.getByText("deployment.recorded", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Incidents" }).click();
  await expect(
    page.getByRole("button", { name: "Trigger synthetic failure" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Trigger synthetic failure" }).click();

  const incident = page
    .getByRole("button", { name: /database connection failed/i })
    .first();
  await expect(incident).toBeVisible({ timeout: 20_000 });
  const ownerIncidentsResponse = await page.request.get(
    `http://localhost:4000/v1/projects/${ownerProjectId}/incidents?limit=10`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  expect(ownerIncidentsResponse.status()).toBe(200);
  const ownerIncidentsPayload: unknown = await ownerIncidentsResponse.json();
  if (
    !isObject(ownerIncidentsPayload) ||
    !Array.isArray(ownerIncidentsPayload.data) ||
    !isObject(ownerIncidentsPayload.data[0]) ||
    typeof ownerIncidentsPayload.data[0].id !== "string"
  )
    throw new Error("The correlated incident was not returned to its owner.");
  const ownerIncidentId = ownerIncidentsPayload.data[0].id;

  const firstIncidentPageResponse = await page.request.get(
    `http://localhost:4000/v1/projects/${ownerProjectId}/incidents?limit=1`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  expect(firstIncidentPageResponse.status()).toBe(200);
  const firstIncidentPage: unknown = await firstIncidentPageResponse.json();
  if (
    !isObject(firstIncidentPage) ||
    !Array.isArray(firstIncidentPage.data) ||
    !isObject(firstIncidentPage.data[0]) ||
    typeof firstIncidentPage.data[0].id !== "string" ||
    !isObject(firstIncidentPage.page) ||
    firstIncidentPage.page.hasMore !== true ||
    typeof firstIncidentPage.page.nextCursor !== "string"
  )
    throw new Error("The incident feed did not return its next cursor.");
  const secondIncidentPageResponse = await page.request.get(
    `http://localhost:4000/v1/projects/${ownerProjectId}/incidents?limit=1&cursor=${encodeURIComponent(firstIncidentPage.page.nextCursor)}`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  expect(secondIncidentPageResponse.status()).toBe(200);
  const secondIncidentPage: unknown = await secondIncidentPageResponse.json();
  if (
    !isObject(secondIncidentPage) ||
    !Array.isArray(secondIncidentPage.data) ||
    !isObject(secondIncidentPage.data[0]) ||
    typeof secondIncidentPage.data[0].id !== "string"
  )
    throw new Error("The incident feed did not return the next page.");
  expect(secondIncidentPage.data[0].id).not.toBe(firstIncidentPage.data[0].id);
  const mismatchedIncidentCursor = await page.request.get(
    `http://localhost:4000/v1/projects/${ownerProjectId}/incidents?limit=1&status=resolved&cursor=${encodeURIComponent(firstIncidentPage.page.nextCursor)}`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  expect(mismatchedIncidentCursor.status()).toBe(400);

  const repeatedSyntheticFailure = await page.request.post(
    `http://localhost:4000/v1/projects/${ownerProjectId}/demo/failure`,
    { headers: { "x-organization-id": createdOrganizationId }, data: {} },
  );
  expect(repeatedSyntheticFailure.status()).toBe(202);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const additionalSyntheticFailure = await page.request.post(
      `http://localhost:4000/v1/projects/${ownerProjectId}/demo/failure`,
      { headers: { "x-organization-id": createdOrganizationId }, data: {} },
    );
    expect(additionalSyntheticFailure.status()).toBe(202);
  }
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `http://localhost:4000/v1/incidents/${ownerIncidentId}/events?limit=30`,
          { headers: { "x-organization-id": createdOrganizationId } },
        );
        if (response.status() !== 200) return false;
        const payload: unknown = await response.json();
        return isObject(payload) && isObject(payload.page)
          ? payload.page.hasMore
          : false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  const firstIncidentEventsResponse = await page.request.get(
    `http://localhost:4000/v1/incidents/${ownerIncidentId}/events?limit=1`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  const firstIncidentEvents: unknown = await firstIncidentEventsResponse.json();
  if (
    !isObject(firstIncidentEvents) ||
    !Array.isArray(firstIncidentEvents.data) ||
    !isObject(firstIncidentEvents.data[0]) ||
    typeof firstIncidentEvents.data[0].linkId !== "string" ||
    !isObject(firstIncidentEvents.page) ||
    typeof firstIncidentEvents.page.nextCursor !== "string"
  )
    throw new Error("The incident event feed did not return its next cursor.");
  const secondIncidentEventsResponse = await page.request.get(
    `http://localhost:4000/v1/incidents/${ownerIncidentId}/events?limit=1&cursor=${encodeURIComponent(firstIncidentEvents.page.nextCursor)}`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  expect(secondIncidentEventsResponse.status()).toBe(200);
  const secondIncidentEvents: unknown =
    await secondIncidentEventsResponse.json();
  if (
    !isObject(secondIncidentEvents) ||
    !Array.isArray(secondIncidentEvents.data) ||
    !isObject(secondIncidentEvents.data[0]) ||
    typeof secondIncidentEvents.data[0].linkId !== "string"
  )
    throw new Error("The incident event feed did not return the next page.");
  expect(secondIncidentEvents.data[0].linkId).not.toBe(
    firstIncidentEvents.data[0].linkId,
  );

  const incidentTimelineRequest = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response
        .url()
        .includes(`/v1/incidents/${ownerIncidentId}/events?limit=30`),
  );
  await incident.click();
  expect((await incidentTimelineRequest).status()).toBe(200);
  const loadMoreEvents = page.getByRole("button", {
    name: "Load more events",
  });
  await expect(loadMoreEvents).toBeVisible();
  const nextTimelinePage = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      response
        .url()
        .includes(`/v1/incidents/${ownerIncidentId}/events?limit=30&cursor=`),
  );
  await loadMoreEvents.click();
  expect((await nextTimelinePage).status()).toBe(200);
  await expect(loadMoreEvents).toHaveCount(0);
  const investigationStart = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/v1/incidents/") &&
      response.url().includes("/investigations"),
  );
  await page.getByRole("button", { name: "Investigate with evidence" }).click();
  const investigationStartResponse = await investigationStart;
  expect(investigationStartResponse.status()).toBe(202);
  const investigationStartPayload: unknown =
    await investigationStartResponse.json();
  if (
    !isObject(investigationStartPayload) ||
    !isObject(investigationStartPayload.data) ||
    typeof investigationStartPayload.data.id !== "string"
  )
    throw new Error("The investigation response did not include its ID.");
  const ownerInvestigationId = investigationStartPayload.data.id;
  const limitedInvestigation = await page.request.post(
    investigationStartResponse.url(),
    {
      headers: { "x-organization-id": createdOrganizationId },
      data: { mode: "evidence_based" },
    },
  );
  expect(limitedInvestigation.status()).toBe(429);
  expect(await limitedInvestigation.json()).toMatchObject({
    error: { code: "RATE_LIMITED" },
  });
  await expect(page.getByText(/^Persisted evidence \(\d+\)$/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/Evidence references:.*supports/)).toBeVisible();
  await expect
    .poll(async () => {
      const response = await page.request.get(
        `http://localhost:4000/v1/investigations/${ownerInvestigationId}`,
        { headers: { "x-organization-id": createdOrganizationId } },
      );
      if (response.status() !== 200) return "unavailable";
      const payload: unknown = await response.json();
      return isObject(payload) && isObject(payload.data)
        ? payload.data.status
        : "unavailable";
    })
    .toBe("completed", { timeout: 20_000 });
  const completedInvestigationCancellation = await page.request.post(
    `http://localhost:4000/v1/investigations/${ownerInvestigationId}/cancel`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  expect(completedInvestigationCancellation.status()).toBe(409);
  expect(await completedInvestigationCancellation.json()).toMatchObject({
    error: { code: "INVESTIGATION_NOT_CANCELLABLE" },
  });
  const completedInvestigationRetry = await page.request.post(
    `http://localhost:4000/v1/investigations/${ownerInvestigationId}/retry`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  expect(completedInvestigationRetry.status()).toBe(409);
  expect(await completedInvestigationRetry.json()).toMatchObject({
    error: { code: "INVESTIGATION_NOT_RETRYABLE" },
  });

  const verificationStart = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response
        .url()
        .includes(`/v1/incidents/${ownerIncidentId}/verification-runs`),
  );
  await page.getByRole("button", { name: "Run recovery check" }).click();
  const verificationStartResponse = await verificationStart;
  expect(verificationStartResponse.status()).toBe(202);
  const verificationStartPayload: unknown =
    await verificationStartResponse.json();
  if (
    !isObject(verificationStartPayload) ||
    !isObject(verificationStartPayload.data) ||
    typeof verificationStartPayload.data.id !== "string"
  )
    throw new Error("The verification response did not include its ID.");
  const ownerVerificationId = verificationStartPayload.data.id;
  await expect(page.getByText("passed", { exact: true }).last()).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page.getByText("sample checkout can query the configured database"),
  ).toBeVisible();
  await expect(
    page.getByText("Expected 200 CHECKOUT_READY; got 200 200 CHECKOUT_READY"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run failure check" }).click();
  await expect(
    page.getByText("sample checkout reports the controlled database failure"),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByText(
      "Expected 503 DATABASE_CONNECTION_FAILED; got 503 503 DATABASE_CONNECTION_FAILED",
    ),
  ).toBeVisible();
  const unauthenticatedScenario = await page.request.get(
    "http://localhost:4100/internal/scenarios/recovery-check",
  );
  expect(unauthenticatedScenario.status()).toBe(401);
  const unauthenticatedRunner = await page.request.post(
    "http://localhost:4200/internal/run",
    { data: { scenarioKey: "recovery-check", scenarioVersion: "1" } },
  );
  expect(unauthenticatedRunner.status()).toBe(401);

  const createRotationKeyResponse = await page.request.post(
    `http://localhost:4000/v1/projects/${ownerProjectId}/api-keys`,
    {
      headers: { "x-organization-id": createdOrganizationId },
      data: { name: "Rotation verification key" },
    },
  );
  expect(
    createRotationKeyResponse.status(),
    await createRotationKeyResponse.text(),
  ).toBe(201);
  const createRotationKeyPayload: unknown =
    await createRotationKeyResponse.json();
  if (
    !isObject(createRotationKeyPayload) ||
    !isObject(createRotationKeyPayload.data) ||
    typeof createRotationKeyPayload.data.id !== "string" ||
    typeof createRotationKeyPayload.data.plaintext !== "string"
  )
    throw new Error("The rotation verification key response was malformed.");
  const rotationOldKeyId = createRotationKeyPayload.data.id;
  const rotationOldKey = createRotationKeyPayload.data.plaintext;

  const keyRotationResponse = await page.request.post(
    `http://localhost:4000/v1/api-keys/${rotationOldKeyId}/rotate`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  expect(keyRotationResponse.status(), await keyRotationResponse.text()).toBe(
    201,
  );
  const keyRotationPayload: unknown = await keyRotationResponse.json();
  if (
    !isObject(keyRotationPayload) ||
    !isObject(keyRotationPayload.data) ||
    typeof keyRotationPayload.data.plaintext !== "string" ||
    typeof keyRotationPayload.data.id !== "string"
  )
    throw new Error("The rotated API key response was malformed.");
  const rotatedProjectKey = keyRotationPayload.data.plaintext;
  const rotatedKeyId = keyRotationPayload.data.id;
  expect(rotatedKeyId).not.toBe(rotationOldKeyId);

  const keysAfterRotationResponse = await page.request.get(
    `http://localhost:4000/v1/projects/${ownerProjectId}/api-keys`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  expect(keysAfterRotationResponse.status()).toBe(200);
  const keysAfterRotationPayload: unknown =
    await keysAfterRotationResponse.json();
  if (
    !isObject(keysAfterRotationPayload) ||
    !Array.isArray(keysAfterRotationPayload.data)
  )
    throw new Error("The API key list after rotation was malformed.");
  const oldKeyAfterRotation = keysAfterRotationPayload.data.find(
    (item): item is Record<string, unknown> =>
      isObject(item) && item.id === rotationOldKeyId,
  );
  const newKeyAfterRotation = keysAfterRotationPayload.data.find(
    (item): item is Record<string, unknown> =>
      isObject(item) && item.id === rotatedKeyId,
  );
  if (!oldKeyAfterRotation || !newKeyAfterRotation)
    throw new Error("Rotation did not leave both old and new key records.");
  expect(oldKeyAfterRotation.revokedAt).not.toBeNull();
  expect(newKeyAfterRotation.revokedAt).toBeNull();

  let oldKeyIngestionStatus = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const oldKeyIngestion = await page.request.post(ingestionUrl, {
      headers: {
        Authorization: `Bearer ${rotationOldKey}`,
        "Idempotency-Key": `e2e-old-rotated-${randomUUID()}-${attempt}`,
      },
      data: telemetryEvent,
    });
    oldKeyIngestionStatus = oldKeyIngestion.status();
    if (oldKeyIngestionStatus !== 429) break;
    await page.waitForTimeout(5000);
  }
  expect(oldKeyIngestionStatus).toBe(401);

  let newKeyIngestionStatus = 0;
  for (let attempt = 0; attempt < 12; attempt++) {
    const newKeyIngestion = await page.request.post(ingestionUrl, {
      headers: {
        Authorization: `Bearer ${rotatedProjectKey}`,
        "Idempotency-Key": `e2e-new-rotated-${randomUUID()}-${attempt}`,
      },
      data: telemetryEvent,
    });
    newKeyIngestionStatus = newKeyIngestion.status();
    if (newKeyIngestionStatus !== 429) break;
    await page.waitForTimeout(5000);
  }
  expect(newKeyIngestionStatus).toBe(200);

  await page.getByRole("button", { name: "Access" }).click();
  await page.getByPlaceholder("person@example.com").fill(invitedEmail);
  await page.locator('select[name="inviteRole"]').selectOption("viewer");
  await page.getByRole("button", { name: "Invite" }).click();
  const invitationLink = await page
    .locator("code")
    .filter({ hasText: "#token=" })
    .innerText();
  expect(invitationLink).toContain("#token=");

  const invitePage = await browser.newPage();
  await invitePage.goto(invitationLink);
  await invitePage
    .getByRole("button", { name: "Create an account instead" })
    .click();
  await invitePage.getByLabel("Name").fill("SignalForge Viewer");
  await invitePage.getByLabel("Email").fill(invitedEmail);
  await invitePage.getByLabel("Password").fill("viewer-test-password-2026");
  await invitePage
    .getByRole("button", { name: "Create account and accept" })
    .click();
  await expect(invitePage.getByRole("status")).toContainText(
    "Invitation accepted.",
  );
  const projectListResponsePromise = invitePage.waitForResponse(
    (response) =>
      response.url().includes("/v1/projects?organizationId=") &&
      response.request().method() === "GET",
  );
  await invitePage.goto("/app");
  const projectListResponse = await projectListResponsePromise;
  const projectListPayload: unknown = await projectListResponse.json();
  if (!isObject(projectListPayload) || !Array.isArray(projectListPayload.data))
    throw new Error("Viewer project response did not contain a project list.");
  const firstProject = projectListPayload.data[0];
  if (!isObject(firstProject) || typeof firstProject.id !== "string")
    throw new Error("Viewer did not receive an accessible project.");
  const viewerOrganizationId = new URL(
    projectListResponse.url(),
  ).searchParams.get("organizationId");
  if (!viewerOrganizationId)
    throw new Error("Viewer project request did not include an organization.");
  await expect(
    invitePage.getByRole("heading", { name: "Incident workspace" }),
  ).toBeVisible();
  await expect(
    invitePage
      .getByRole("button", { name: /database connection failed/i })
      .first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    invitePage.getByRole("button", { name: "Trigger synthetic failure" }),
  ).toHaveCount(0);
  await invitePage
    .getByRole("button", { name: /database connection failed/i })
    .first()
    .click();
  await expect(
    invitePage.getByRole("button", { name: "Investigate with evidence" }),
  ).toHaveCount(0);
  await expect(
    invitePage.getByRole("button", { name: "Run recovery check" }),
  ).toHaveCount(0);
  const viewerWriteAttempt = await invitePage.request.post(
    `http://localhost:4000/v1/projects/${firstProject.id}/demo/failure`,
    { headers: { "x-organization-id": viewerOrganizationId }, data: {} },
  );
  expect(viewerWriteAttempt.status()).toBe(403);
  const viewerCancellationAttempt = await invitePage.request.post(
    `http://localhost:4000/v1/investigations/${ownerInvestigationId}/cancel`,
    { headers: { "x-organization-id": viewerOrganizationId } },
  );
  expect(viewerCancellationAttempt.status()).toBe(403);
  expect(await viewerCancellationAttempt.json()).toMatchObject({
    error: { code: "FORBIDDEN" },
  });
  const viewerRetryAttempt = await invitePage.request.post(
    `http://localhost:4000/v1/investigations/${ownerInvestigationId}/retry`,
    { headers: { "x-organization-id": viewerOrganizationId }, timeout: 10_000 },
  );
  expect(viewerRetryAttempt.status()).toBe(429);
  expect(await viewerRetryAttempt.json()).toMatchObject({
    error: { code: "RATE_LIMITED" },
  });

  const currentMembersResponse = await page.request.get(
    `http://localhost:4000/v1/organizations/${createdOrganizationId}/members`,
    { timeout: 10_000 },
  );
  expect(currentMembersResponse.status()).toBe(200);
  const currentMembersPayload: unknown = await currentMembersResponse.json();
  if (
    !isObject(currentMembersPayload) ||
    !Array.isArray(currentMembersPayload.data)
  )
    throw new Error("The organization member response was malformed.");
  const viewerMembership = currentMembersPayload.data.find(
    (candidate) => isObject(candidate) && candidate.email === invitedEmail,
  );
  if (
    !isObject(viewerMembership) ||
    typeof viewerMembership.userId !== "string"
  )
    throw new Error("The invited viewer was missing from the member list.");

  await invitePage.evaluate(
    ({ organizationId, projectId }) => {
      const stream = new EventSource(
        `/v1/projects/${projectId}/stream?organizationId=${encodeURIComponent(organizationId)}`,
      );
      const state = { messages: 0, failed: false, stream };
      stream.onmessage = () => {
        state.messages += 1;
      };
      stream.onerror = () => {
        state.failed = true;
        stream.close();
      };
      (
        window as Window & {
          signalForgeMembershipStream?: typeof state;
        }
      ).signalForgeMembershipStream = state;
    },
    { organizationId: viewerOrganizationId, projectId: firstProject.id },
  );
  await expect
    .poll(
      () =>
        invitePage.evaluate(
          () =>
            (
              window as Window & {
                signalForgeMembershipStream?: { messages: number };
              }
            ).signalForgeMembershipStream?.messages ?? 0,
        ),
      { timeout: 10_000 },
    )
    .toBeGreaterThan(0);
  const removeViewer = await page.request.delete(
    `http://localhost:4000/v1/organizations/${createdOrganizationId}/members/${viewerMembership.userId}`,
  );
  expect(removeViewer.status()).toBe(200);
  await expect
    .poll(
      () =>
        invitePage.evaluate(
          () =>
            (
              window as Window & {
                signalForgeMembershipStream?: { failed: boolean };
              }
            ).signalForgeMembershipStream?.failed ?? false,
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  const revokedViewerRequest = await invitePage.request.get(
    `http://localhost:4000/v1/projects?organizationId=${viewerOrganizationId}`,
  );
  expect(revokedViewerRequest.status()).toBe(404);
  await invitePage.context().close();

  const isolatedTenantContext = await browser.newContext();
  const isolatedTenantPage = await isolatedTenantContext.newPage();
  const isolatedTenantEmail = `signalforge-isolated-${randomUUID()}@example.test`;
  const revokedInvitationResponse = await page.request.post(
    `http://localhost:4000/v1/organizations/${createdOrganizationId}/invitations`,
    {
      headers: { "x-organization-id": createdOrganizationId },
      data: { email: isolatedTenantEmail, role: "viewer" },
    },
  );
  expect(revokedInvitationResponse.status()).toBe(201);
  const revokedInvitationPayload: unknown =
    await revokedInvitationResponse.json();
  if (
    !isObject(revokedInvitationPayload) ||
    !isObject(revokedInvitationPayload.data) ||
    typeof revokedInvitationPayload.data.id !== "string" ||
    typeof revokedInvitationPayload.data.token !== "string"
  )
    throw new Error("The invitation revocation fixture was malformed.");
  const revokedInvitationId = revokedInvitationPayload.data.id;
  const revokedInvitationToken = revokedInvitationPayload.data.token;
  const isolatedSignup = await isolatedTenantPage.request.post(
    "http://localhost:4000/api/auth/sign-up/email",
    {
      headers: { Origin: "http://localhost:3000" },
      data: {
        name: "Isolated Tenant Owner",
        email: isolatedTenantEmail,
        password: "isolated-tenant-password-2026",
      },
    },
  );
  expect(isolatedSignup.status(), await isolatedSignup.text()).toBe(200);
  const invitationRevocation = await page.request.delete(
    `http://localhost:4000/v1/organizations/${createdOrganizationId}/invitations/${revokedInvitationId}`,
    { headers: { "x-organization-id": createdOrganizationId } },
  );
  expect(invitationRevocation.status()).toBe(200);
  const revokedInvitationAcceptance = await isolatedTenantPage.request.post(
    "http://localhost:4000/v1/invitations/accept",
    { data: { token: revokedInvitationToken } },
  );
  expect(revokedInvitationAcceptance.status()).toBe(404);
  expect(await revokedInvitationAcceptance.json()).toMatchObject({
    error: { code: "INVITATION_NOT_FOUND" },
  });
  const isolatedActorResponse = await isolatedTenantPage.request.get(
    "http://localhost:4000/v1/me",
  );
  expect(isolatedActorResponse.status()).toBe(200);
  const isolatedActorPayload: unknown = await isolatedActorResponse.json();
  if (
    !isObject(isolatedActorPayload) ||
    !isObject(isolatedActorPayload.data) ||
    isolatedActorPayload.data.email !== isolatedTenantEmail
  )
    throw new Error("The second tenant did not receive its own session.");
  const isolatedOnboarding = await isolatedTenantPage.request.post(
    "http://localhost:4000/v1/onboarding",
    {
      data: {
        organizationName: "Isolated E2E Workspace",
        projectName: "Isolated E2E Project",
        projectSlug: `isolated-${randomUUID().slice(0, 8)}`,
      },
    },
  );
  expect(isolatedOnboarding.status(), await isolatedOnboarding.text()).toBe(
    201,
  );
  const isolatedWorkspacePayload: unknown = await isolatedOnboarding.json();
  if (
    !isObject(isolatedWorkspacePayload) ||
    !isObject(isolatedWorkspacePayload.data) ||
    !isObject(isolatedWorkspacePayload.data.organization) ||
    typeof isolatedWorkspacePayload.data.organization.id !== "string"
  )
    throw new Error("The second tenant workspace was not created.");
  const isolatedOrganizationId = isolatedWorkspacePayload.data.organization.id;
  expect(isolatedOrganizationId).not.toBe(createdOrganizationId);

  const isolatedOrganizationsResponse = await isolatedTenantPage.request.get(
    "http://localhost:4000/v1/me/organizations",
  );
  expect(isolatedOrganizationsResponse.status()).toBe(200);
  const isolatedOrganizationsPayload: unknown =
    await isolatedOrganizationsResponse.json();
  if (
    !isObject(isolatedOrganizationsPayload) ||
    !Array.isArray(isolatedOrganizationsPayload.data)
  )
    throw new Error("The second tenant organization list was malformed.");
  expect(
    isolatedOrganizationsPayload.data.some(
      (organization) =>
        isObject(organization) && organization.id === createdOrganizationId,
    ),
  ).toBe(false);

  const secondTenantHeaders = {
    "x-organization-id": isolatedOrganizationId,
  };
  const crossTenantReadPaths = [
    `/v1/projects/${ownerProjectId}`,
    `/v1/projects/${ownerProjectId}/environments`,
    `/v1/projects/${ownerProjectId}/services`,
    `/v1/projects/${ownerProjectId}/api-keys`,
    `/v1/projects/${ownerProjectId}/deployments`,
    `/v1/projects/${ownerProjectId}/incidents?limit=10`,
    `/v1/projects/${ownerProjectId}/stream?organizationId=${isolatedOrganizationId}`,
    `/v1/projects/${ownerProjectId}/test-scenarios`,
    `/v1/incidents/${ownerIncidentId}`,
    `/v1/incidents/${ownerIncidentId}/events`,
    `/v1/incidents/${ownerIncidentId}/investigations`,
    `/v1/incidents/${ownerIncidentId}/verification-runs`,
    `/v1/investigations/${ownerInvestigationId}`,
    `/v1/investigations/${ownerInvestigationId}/evidence`,
    `/v1/investigations/${ownerInvestigationId}/hypotheses`,
    `/v1/verification-runs/${ownerVerificationId}`,
  ];
  const crossTenantEmptyListPaths = new Set([
    `/v1/incidents/${ownerIncidentId}/events`,
    `/v1/incidents/${ownerIncidentId}/investigations`,
    `/v1/incidents/${ownerIncidentId}/verification-runs`,
    `/v1/investigations/${ownerInvestigationId}/evidence`,
    `/v1/investigations/${ownerInvestigationId}/hypotheses`,
  ]);
  for (const path of crossTenantReadPaths) {
    const response = await isolatedTenantPage.request.get(
      `http://localhost:4000${path}`,
      { headers: secondTenantHeaders },
    );
    if (crossTenantEmptyListPaths.has(path)) {
      expect(response.status(), `cross-tenant GET ${path}`).toBe(200);
      const payload: unknown = await response.json();
      if (!isObject(payload) || !Array.isArray(payload.data))
        throw new Error(`Cross-tenant list ${path} returned a malformed body.`);
      expect(payload.data, `cross-tenant rows from ${path}`).toHaveLength(0);
    } else {
      expect(response.status(), `cross-tenant GET ${path}`).toBe(404);
    }
  }
  const crossTenantOrganizationPaths = [
    `/v1/organizations/${createdOrganizationId}/members`,
    `/v1/organizations/${createdOrganizationId}/invitations`,
    `/v1/projects?organizationId=${createdOrganizationId}`,
    `/v1/audit?organizationId=${createdOrganizationId}`,
  ];
  for (const path of crossTenantOrganizationPaths) {
    const response = await isolatedTenantPage.request.get(
      `http://localhost:4000${path}`,
      { headers: secondTenantHeaders },
    );
    expect(response.status(), `cross-tenant GET ${path}`).toBe(404);
  }
  const crossTenantEnvironmentWrite = await isolatedTenantPage.request.post(
    `http://localhost:4000/v1/projects/${ownerProjectId}/environments`,
    {
      headers: secondTenantHeaders,
      data: { name: "Unauthorized environment", slug: "unauthorized" },
    },
  );
  expect(crossTenantEnvironmentWrite.status()).toBe(404);
  const crossTenantKeyRevoke = await isolatedTenantPage.request.delete(
    `http://localhost:4000/v1/api-keys/${ownerApiKeyId}`,
    { headers: secondTenantHeaders },
  );
  expect(crossTenantKeyRevoke.status()).toBe(404);
  const crossTenantKeyRotate = await isolatedTenantPage.request.post(
    `http://localhost:4000/v1/api-keys/${ownerApiKeyId}/rotate`,
    { headers: secondTenantHeaders },
  );
  expect(crossTenantKeyRotate.status()).toBe(404);
  const crossTenantWrites = [
    await isolatedTenantPage.request.post(
      `http://localhost:4000/v1/investigations/${ownerInvestigationId}/cancel`,
      { headers: secondTenantHeaders },
    ),
    await isolatedTenantPage.request.patch(
      `http://localhost:4000/v1/projects/${ownerProjectId}`,
      {
        headers: secondTenantHeaders,
        data: { name: "Unauthorized project edit" },
      },
    ),
    await isolatedTenantPage.request.post(
      `http://localhost:4000/v1/projects/${ownerProjectId}/services`,
      {
        headers: secondTenantHeaders,
        data: { name: "Unauthorized service", serviceKey: "unauthorized" },
      },
    ),
    await isolatedTenantPage.request.post(
      `http://localhost:4000/v1/projects/${ownerProjectId}/api-keys`,
      { headers: secondTenantHeaders, data: { name: "Unauthorized key" } },
    ),
    await isolatedTenantPage.request.post(
      `http://localhost:4000/v1/projects/${ownerProjectId}/deployments`,
      { headers: secondTenantHeaders, data: {} },
    ),
    await isolatedTenantPage.request.post(
      `http://localhost:4000/v1/projects/${ownerProjectId}/demo/failure`,
      { headers: secondTenantHeaders, data: {} },
    ),
    await isolatedTenantPage.request.patch(
      `http://localhost:4000/v1/incidents/${ownerIncidentId}/status`,
      {
        headers: secondTenantHeaders,
        data: { status: "resolved" },
      },
    ),
  ];
  for (const response of crossTenantWrites) expect(response.status()).toBe(404);
  const crossTenantProjectCreate = await isolatedTenantPage.request.post(
    "http://localhost:4000/v1/projects",
    {
      headers: { "x-organization-id": createdOrganizationId },
      data: {
        name: "Unauthorized project",
        slug: `unauthorized-${randomUUID().slice(0, 8)}`,
      },
    },
  );
  expect(crossTenantProjectCreate.status()).toBe(404);
  const crossTenantInvitationCreate = await isolatedTenantPage.request.post(
    `http://localhost:4000/v1/organizations/${createdOrganizationId}/invitations`,
    {
      data: { email: "cross-tenant@example.test", role: "viewer" },
    },
  );
  expect(crossTenantInvitationCreate.status()).toBe(404);
  const crossTenantMemberUpdate = await isolatedTenantPage.request.patch(
    `http://localhost:4000/v1/organizations/${createdOrganizationId}/members/${ownerUserId}`,
    { data: { role: "viewer" } },
  );
  expect(crossTenantMemberUpdate.status()).toBe(404);
  const crossTenantMemberRemoval = await isolatedTenantPage.request.delete(
    `http://localhost:4000/v1/organizations/${createdOrganizationId}/members/${ownerUserId}`,
  );
  expect(crossTenantMemberRemoval.status()).toBe(404);
  const crossTenantVerification = await isolatedTenantPage.request.post(
    `http://localhost:4000/v1/incidents/${ownerIncidentId}/verification-runs`,
    {
      headers: secondTenantHeaders,
      data: { scenarioKey: "recovery-check" },
    },
  );
  expect(crossTenantVerification.status()).toBe(404);
  await isolatedTenantContext.close();
});
