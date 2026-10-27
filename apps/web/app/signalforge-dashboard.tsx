"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { SignalForgeLogo } from "./signalforge-logo";

type Actor = { userId: string; email: string; displayName: string };
type Organization = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "admin" | "member" | "viewer";
};
type Project = { id: string; name: string; slug: string };
type Incident = {
  id: string;
  title: string;
  severity: string;
  status: string;
  eventCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  fingerprint: string;
};
type EventRow = {
  linkId: string;
  eventId: string;
  eventType: string;
  severity: string;
  occurredAt: string;
  message: string;
  traceId: string | null;
  linkType: string;
};
type Deployment = {
  id: string;
  version: string;
  deployedAt: string;
  relation: string;
};
type IncidentDetail = {
  incident: Incident;
  events: EventRow[];
  relatedDeployments: Deployment[];
};
type IncidentEventPage = {
  data: EventRow[];
  page: { hasMore: boolean; nextCursor: string | null };
};
type Investigation = {
  id: string;
  status: string;
  provider: string;
  model: string;
  summary: string | null;
  errorCode: string | null;
  createdAt: string;
  finishedAt: string | null;
};
const retryableInvestigationErrors = new Set([
  "JOB_RETRIES_EXHAUSTED",
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
]);
type Evidence = {
  id: string;
  sourceType: string;
  title: string;
  content: string;
  capturedAt: string;
};
type Hypothesis = {
  id: string;
  claim: string;
  rationale: string;
  confidence: string;
  evidence: Array<{ evidenceId: string; relationship: string }>;
};
type Verification = {
  id: string;
  status: string;
  summary: string | null;
  report: {
    assertions: Array<{
      name: string;
      passed: boolean;
      expected: string;
      actual: string;
    }>;
  } | null;
  createdAt: string;
  finishedAt: string | null;
};
type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
type EnvironmentRow = { id: string; name: string; slug: string };
type ServiceRow = {
  id: string;
  name: string;
  serviceKey: string;
  description: string | null;
};
type DeploymentRow = {
  id: string;
  version: string;
  status: string;
  commitSha: string | null;
  deployedAt: string;
};
type AuditRecord = {
  id: string;
  actorUserId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  requestId: string | null;
  outcome: string;
  createdAt: string;
};
type OrganizationMember = {
  userId: string;
  email: string;
  name: string;
  role: "owner" | "admin" | "member" | "viewer";
  joinedAt: string;
};
type OrganizationInvitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
type OneTimeKey = { plaintext: string; name: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  organizationId?: string,
  unwrapData = true,
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  if (organizationId) headers.set("x-organization-id", organizationId);
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message =
      isObject(body) &&
      isObject(body.error) &&
      typeof body.error.message === "string"
        ? body.error.message
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  if (unwrapData && isObject(body) && "data" in body) return body.data as T;
  return body as T;
}

const json = (value: unknown): string => JSON.stringify(value);
const liveIncidentSchema = z.object({
  incidents: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      severity: z.string(),
      status: z.string(),
      eventCount: z.number(),
      firstSeenAt: z.string(),
      lastSeenAt: z.string(),
      fingerprint: z.string(),
    }),
  ),
});
const dateTime = (value: string): string =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
const statusTone = (value: string): string =>
  ({
    open: "bg-rose-50 text-rose-700",
    investigating: "bg-amber-50 text-amber-700",
    monitoring: "bg-sky-50 text-sky-700",
    resolved: "bg-emerald-50 text-emerald-700",
    queued: "bg-slate-100 text-slate-600",
    running: "bg-blue-50 text-blue-700",
    completed: "bg-emerald-50 text-emerald-700",
    failed: "bg-rose-50 text-rose-700",
    passed: "bg-emerald-50 text-emerald-700",
    error: "bg-rose-50 text-rose-700",
  })[value] ?? "bg-slate-100 text-slate-600";

export default function Dashboard() {
  const [actor, setActor] = useState<Actor | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [incidentId, setIncidentId] = useState("");
  const [detail, setDetail] = useState<IncidentDetail | null>(null);
  const [incidentEvents, setIncidentEvents] = useState<EventRow[]>([]);
  const [incidentEventsCursor, setIncidentEventsCursor] = useState<
    string | null
  >(null);
  const [incidentEventsHasMore, setIncidentEventsHasMore] = useState(false);
  const [incidentEventsLoading, setIncidentEventsLoading] = useState(false);
  const [activeInvestigation, setActiveInvestigation] =
    useState<Investigation | null>(null);
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [environments, setEnvironments] = useState<EnvironmentRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [deployments, setDeployments] = useState<DeploymentRow[]>([]);
  const [auditRecords, setAuditRecords] = useState<AuditRecord[]>([]);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [invitationLink, setInvitationLink] = useState("");
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [oneTimeKey, setOneTimeKey] = useState<OneTimeKey | null>(null);
  const [view, setView] = useState<
    "incidents" | "keys" | "access" | "resources" | "audit"
  >("incidents");
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [liveConnected, setLiveConnected] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const organization = useMemo(
    () => organizations.find((item) => item.id === organizationId) ?? null,
    [organizations, organizationId],
  );
  const canOperateIncidents =
    organization !== null && organization.role !== "viewer";
  const project = useMemo(
    () => projects.find((item) => item.id === projectId) ?? null,
    [projects, projectId],
  );

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const currentActor = await apiRequest<Actor>("/v1/me");
      const orgs = await apiRequest<Organization[]>("/v1/me/organizations");
      setActor(currentActor);
      setOrganizations(orgs);
      setOrganizationId((current) =>
        orgs.some((item) => item.id === current)
          ? current
          : (orgs[0]?.id ?? ""),
      );
    } catch {
      setActor(null);
      setOrganizations([]);
      setOrganizationId("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  useEffect(() => {
    if (!organizationId) {
      setProjects([]);
      setProjectId("");
      return;
    }
    let cancelled = false;
    void apiRequest<Project[]>(
      `/v1/projects?organizationId=${encodeURIComponent(organizationId)}`,
    )
      .then((rows) => {
        if (!cancelled) {
          setProjects(rows);
          setProjectId((current) =>
            rows.some((item) => item.id === current)
              ? current
              : (rows[0]?.id ?? ""),
          );
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Projects could not be loaded.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const refreshIncidents = useCallback(async () => {
    if (!projectId) {
      setIncidents([]);
      return;
    }
    const rows = await apiRequest<Incident[]>(
      `/v1/projects/${projectId}/incidents?limit=50`,
      {},
      organizationId,
    );
    setIncidents(rows);
    setIncidentId((current) =>
      rows.some((item) => item.id === current) ? current : (rows[0]?.id ?? ""),
    );
  }, [organizationId, projectId]);

  useEffect(() => {
    if (!projectId || view !== "incidents") return;
    let cancelled = false;
    const stream = new EventSource(
      `/v1/projects/${projectId}/stream?organizationId=${encodeURIComponent(organizationId)}`,
      { withCredentials: true },
    );
    stream.onopen = () => {
      if (!cancelled) setLiveConnected(true);
    };
    stream.onerror = () => {
      if (!cancelled) setLiveConnected(false);
    };
    stream.onmessage = (event) => {
      try {
        const parsed = liveIncidentSchema.safeParse(
          JSON.parse(event.data) as unknown,
        );
        if (!parsed.success || cancelled) return;
        setIncidents(parsed.data.incidents);
        setIncidentId((current) =>
          parsed.data.incidents.some((item) => item.id === current)
            ? current
            : (parsed.data.incidents[0]?.id ?? ""),
        );
      } catch {
        setLiveConnected(false);
      }
    };
    const refresh = () => {
      void refreshIncidents().catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Incidents could not be refreshed.",
          );
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      setLiveConnected(false);
      stream.close();
      window.clearInterval(timer);
    };
  }, [organizationId, projectId, view, refreshIncidents]);

  const refreshDetail = useCallback(async () => {
    if (!incidentId || !organizationId) {
      setDetail(null);
      return;
    }
    const [incidentData, investigationRows, verificationRows] =
      await Promise.all([
        apiRequest<IncidentDetail>(
          `/v1/incidents/${incidentId}`,
          {},
          organizationId,
        ),
        apiRequest<Investigation[]>(
          `/v1/incidents/${incidentId}/investigations`,
          {},
          organizationId,
        ),
        apiRequest<Verification[]>(
          `/v1/incidents/${incidentId}/verification-runs`,
          {},
          organizationId,
        ),
      ]);
    setDetail(incidentData);
    setVerifications(verificationRows);
    const newest = investigationRows[0];
    setActiveInvestigation(newest ?? null);
    if (newest) {
      const [investigation, evidenceRows, hypothesisRows] = await Promise.all([
        apiRequest<Investigation>(
          `/v1/investigations/${newest.id}`,
          {},
          organizationId,
        ),
        apiRequest<Evidence[]>(
          `/v1/investigations/${newest.id}/evidence`,
          {},
          organizationId,
        ),
        apiRequest<Hypothesis[]>(
          `/v1/investigations/${newest.id}/hypotheses`,
          {},
          organizationId,
        ),
      ]);
      setActiveInvestigation(investigation);
      setEvidence(evidenceRows);
      setHypotheses(hypothesisRows);
    } else {
      setEvidence([]);
      setHypotheses([]);
    }
  }, [incidentId, organizationId]);

  useEffect(() => {
    if (!incidentId || !organizationId || view !== "incidents") {
      setIncidentEvents([]);
      setIncidentEventsCursor(null);
      setIncidentEventsHasMore(false);
      return;
    }
    let cancelled = false;
    setIncidentEvents([]);
    setIncidentEventsCursor(null);
    setIncidentEventsHasMore(false);
    setIncidentEventsLoading(true);
    void apiRequest<IncidentEventPage>(
      `/v1/incidents/${incidentId}/events?limit=30`,
      {},
      organizationId,
      false,
    )
      .then((page) => {
        if (cancelled) return;
        setIncidentEvents(page.data);
        setIncidentEventsCursor(page.page.nextCursor);
        setIncidentEventsHasMore(page.page.hasMore);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Incident events could not be loaded.",
          );
      })
      .finally(() => {
        if (!cancelled) setIncidentEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [incidentId, organizationId, view]);

  const loadMoreIncidentEvents = useCallback(async () => {
    if (
      !incidentId ||
      !organizationId ||
      !incidentEventsCursor ||
      incidentEventsLoading
    )
      return;
    setIncidentEventsLoading(true);
    try {
      const page = await apiRequest<IncidentEventPage>(
        `/v1/incidents/${incidentId}/events?limit=30&cursor=${encodeURIComponent(incidentEventsCursor)}`,
        {},
        organizationId,
        false,
      );
      setIncidentEvents((current) => [...current, ...page.data]);
      setIncidentEventsCursor(page.page.nextCursor);
      setIncidentEventsHasMore(page.page.hasMore);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "More incident events could not be loaded.",
      );
    } finally {
      setIncidentEventsLoading(false);
    }
  }, [incidentEventsCursor, incidentEventsLoading, incidentId, organizationId]);

  useEffect(() => {
    if (!incidentId || view !== "incidents") return;
    let cancelled = false;
    const refresh = () => {
      void refreshDetail().catch((cause: unknown) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Incident details could not be loaded.",
          );
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [incidentId, view, refreshDetail]);

  const refreshKeys = useCallback(async () => {
    if (!projectId || !organizationId) return;
    const rows = await apiRequest<ApiKey[]>(
      `/v1/projects/${projectId}/api-keys`,
      {},
      organizationId,
    );
    setKeys(rows);
  }, [organizationId, projectId]);

  const refreshAccess = useCallback(async () => {
    if (!organizationId) return;
    const memberRows = await apiRequest<OrganizationMember[]>(
      `/v1/organizations/${organizationId}/members`,
    );
    const invitationRows =
      organization && ["owner", "admin"].includes(organization.role)
        ? await apiRequest<OrganizationInvitation[]>(
            `/v1/organizations/${organizationId}/invitations`,
          )
        : [];
    setMembers(memberRows);
    setInvitations(invitationRows);
  }, [organization, organizationId]);

  const refreshResources = useCallback(async () => {
    if (!organizationId || !projectId) return;
    const [environmentRows, serviceRows, deploymentRows] = await Promise.all([
      apiRequest<EnvironmentRow[]>(
        `/v1/projects/${projectId}/environments`,
        {},
        organizationId,
      ),
      apiRequest<ServiceRow[]>(
        `/v1/projects/${projectId}/services`,
        {},
        organizationId,
      ),
      apiRequest<DeploymentRow[]>(
        `/v1/projects/${projectId}/deployments`,
        {},
        organizationId,
      ),
    ]);
    setEnvironments(environmentRows);
    setServices(serviceRows);
    setDeployments(deploymentRows);
  }, [organizationId, projectId]);

  const refreshAudit = useCallback(async () => {
    if (!organizationId) return;
    const rows = await apiRequest<AuditRecord[]>(
      `/v1/audit?organizationId=${encodeURIComponent(organizationId)}&limit=100`,
    );
    setAuditRecords(rows);
  }, [organizationId]);

  useEffect(() => {
    if (view !== "keys" || !projectId) return;
    void refreshKeys().catch((cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "API keys could not be loaded.",
      ),
    );
  }, [projectId, view, refreshKeys]);

  useEffect(() => {
    if (view !== "access" || !organizationId) return;
    void refreshAccess().catch((cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Organization access could not be loaded.",
      ),
    );
  }, [organizationId, view, refreshAccess]);

  useEffect(() => {
    if (view !== "resources" || !projectId) return;
    void refreshResources().catch((cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Project resources could not be loaded.",
      ),
    );
  }, [projectId, view, refreshResources]);

  useEffect(() => {
    if (view !== "audit" || !organizationId) return;
    void refreshAudit().catch((cause: unknown) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Audit records could not be loaded.",
      ),
    );
  }, [organizationId, view, refreshAudit]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const body = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      ...(authMode === "sign-up"
        ? { name: String(form.get("name") ?? "") }
        : {}),
    };
    try {
      await apiRequest<unknown>(
        `/api/auth/${authMode === "sign-up" ? "sign-up" : "sign-in"}/email`,
        { method: "POST", body: json(body) },
      );
      await loadSession();
      setMessage(
        authMode === "sign-up"
          ? "Account created. Set up your first workspace below."
          : "Signed in.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Authentication failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleOnboarding(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData(event.currentTarget);
    const organizationName = String(form.get("organizationName") ?? "").trim();
    const projectName = String(form.get("projectName") ?? "").trim();
    const projectSlug = String(form.get("projectSlug") ?? "").trim();
    try {
      const result = await apiRequest<{
        organization: Organization;
        project: Project;
        ingestionKey: string;
      }>("/v1/onboarding", {
        method: "POST",
        body: json({ organizationName, projectName, projectSlug }),
      });
      setOneTimeKey({
        plaintext: result.ingestionKey,
        name: "Initial ingestion key",
      });
      await loadSession();
      setMessage(
        "Workspace created. Copy the initial key now; it will not be shown again.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Workspace setup failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const created = await apiRequest<Project>(
        "/v1/projects",
        {
          method: "POST",
          body: json({
            name: String(form.get("projectName") ?? ""),
            slug: String(form.get("projectSlug") ?? ""),
            description: String(form.get("projectDescription") ?? ""),
          }),
        },
        organizationId,
      );
      const rows = await apiRequest<Project[]>(
        `/v1/projects?organizationId=${encodeURIComponent(organizationId)}`,
      );
      setProjects(rows);
      setProjectId(created.id);
      setProjectFormOpen(false);
      setMessage(
        "Project created with a staging environment, demo service, and registered verification scenarios.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Project could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createEnvironment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(
        `/v1/projects/${projectId}/environments`,
        {
          method: "POST",
          body: json({
            name: String(form.get("environmentName") ?? ""),
            slug: String(form.get("environmentSlug") ?? ""),
          }),
        },
        organizationId,
      );
      await refreshResources();
      setMessage("Environment created.");
      formElement.reset();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Environment was not created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(
        `/v1/projects/${projectId}/services`,
        {
          method: "POST",
          body: json({
            name: String(form.get("serviceName") ?? ""),
            serviceKey: String(form.get("serviceKey") ?? ""),
            description: String(form.get("serviceDescription") ?? ""),
          }),
        },
        organizationId,
      );
      await refreshResources();
      setMessage("Service registered.");
      formElement.reset();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Service was not registered.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createDeployment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(
        `/v1/projects/${projectId}/deployments`,
        {
          method: "POST",
          body: json({
            environmentId: String(form.get("environmentId") ?? ""),
            version: String(form.get("deploymentVersion") ?? ""),
            commitSha: String(form.get("commitSha") ?? "") || undefined,
            status: String(form.get("deploymentStatus") ?? "succeeded"),
            deployedAt: new Date().toISOString(),
            metadata: {},
          }),
        },
        organizationId,
      );
      await refreshResources();
      setMessage("Deployment recorded.");
      formElement.reset();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Deployment was not recorded.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function triggerFailure() {
    if (!projectId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(
        `/v1/projects/${projectId}/demo/failure`,
        { method: "POST", body: "{}" },
        organizationId,
      );
      setMessage(
        "Synthetic checkout failure recorded. The incident will appear after event correlation runs.",
      );
      window.setTimeout(() => {
        void refreshIncidents();
      }, 1000);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The sample failure could not be triggered.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createInvestigation() {
    if (!incidentId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(
        `/v1/incidents/${incidentId}/investigations`,
        { method: "POST", body: json({ mode: "evidence_based" }) },
        organizationId,
      );
      setMessage(
        "Investigation queued. Evidence, hypotheses, and status refresh automatically.",
      );
      await refreshDetail();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Investigation could not be queued.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvestigation() {
    if (!activeInvestigation || !organizationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(
        `/v1/investigations/${activeInvestigation.id}/cancel`,
        { method: "POST" },
        organizationId,
      );
      setMessage("Queued investigation cancelled.");
      await refreshDetail();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The queued investigation could not be cancelled.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryInvestigation() {
    if (!activeInvestigation || !organizationId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(
        `/v1/investigations/${activeInvestigation.id}/retry`,
        { method: "POST" },
        organizationId,
      );
      setMessage("Investigation retry queued.");
      await refreshDetail();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The investigation could not be retried.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createVerification(
    scenarioKey: "known-failure" | "recovery-check",
  ) {
    if (!incidentId) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await apiRequest(
        `/v1/incidents/${incidentId}/verification-runs`,
        { method: "POST", body: json({ scenarioKey }) },
        organizationId,
      );
      setMessage(
        "Registered verification scenario queued. The runner reports its actual assertions.",
      );
      await refreshDetail();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Verification could not be queued.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function changeIncidentStatus(
    status: "investigating" | "monitoring" | "resolved" | "open",
  ) {
    if (!incidentId) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(
        `/v1/incidents/${incidentId}/status`,
        { method: "PATCH", body: json({ status }) },
        organizationId,
      );
      await Promise.all([refreshDetail(), refreshIncidents()]);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Incident status was not changed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const created = await apiRequest<{
        id: string;
        name: string;
        plaintext: string;
      }>(
        `/v1/projects/${projectId}/api-keys`,
        {
          method: "POST",
          body: json({
            name: String(form.get("keyName") ?? "New ingestion key"),
          }),
        },
        organizationId,
      );
      setOneTimeKey({ plaintext: created.plaintext, name: created.name });
      setMessage(
        "Key created. Copy it now; only its prefix is stored for display.",
      );
      await refreshKeys();
      formElement.reset();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "API key could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function rotateKey(keyId: string) {
    setBusy(true);
    setError("");
    try {
      const rotated = await apiRequest<{
        id: string;
        name: string;
        plaintext: string;
      }>(
        `/v1/api-keys/${keyId}/rotate`,
        { method: "POST" },
        organizationId,
      );
      setOneTimeKey({ plaintext: rotated.plaintext, name: rotated.name });
      setMessage("Key rotated. Copy the new secret now; the previous key is revoked.");
      await refreshKeys();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "API key could not be rotated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeKey(keyId: string) {
    setBusy(true);
    setError("");
    try {
      await apiRequest(
        `/v1/api-keys/${keyId}`,
        { method: "DELETE" },
        organizationId,
      );
      await refreshKeys();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "API key could not be revoked.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function createInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const created = await apiRequest<{ token: string; email: string }>(
        `/v1/organizations/${organizationId}/invitations`,
        {
          method: "POST",
          body: json({
            email: String(form.get("inviteEmail") ?? ""),
            role: String(form.get("inviteRole") ?? "member"),
          }),
        },
      );
      setInvitationLink(
        `${window.location.origin}/invite#token=${encodeURIComponent(created.token)}`,
      );
      setMessage(
        `Invitation for ${created.email} created. Copy and send the link; email delivery is not configured.`,
      );
      await refreshAccess();
      formElement.reset();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Invitation could not be created.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revokeInvitation(invitationId: string) {
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(
        `/v1/organizations/${organizationId}/invitations/${invitationId}`,
        { method: "DELETE" },
      );
      await refreshAccess();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Invitation could not be revoked.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function updateMemberRole(
    userId: string,
    role: OrganizationMember["role"],
  ) {
    if (!organizationId) return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(
        `/v1/organizations/${organizationId}/members/${encodeURIComponent(userId)}`,
        { method: "PATCH", body: json({ role }) },
      );
      await refreshAccess();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Member role could not be updated.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(userId: string) {
    if (
      !organizationId ||
      !window.confirm("Remove this member from the organization?")
    )
      return;
    setBusy(true);
    setError("");
    try {
      await apiRequest(
        `/v1/organizations/${organizationId}/members/${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
      await refreshAccess();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Member could not be removed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await apiRequest<unknown>("/api/auth/sign-out", {
        method: "POST",
        body: "{}",
      });
      setActor(null);
      setOrganizations([]);
      setProjects([]);
      setIncidents([]);
      setDetail(null);
      setOneTimeKey(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign out failed.");
    } finally {
      setBusy(false);
    }
  }

  if (loading)
    return (
      <main className="workspace grid min-h-screen place-items-center text-sm text-muted">
        Loading SignalForge…
      </main>
    );

  if (!actor)
    return (
      <main className="workspace min-h-screen px-5 py-12">
        <div className="mx-auto grid max-w-5xl gap-10 lg:grid-cols-[1.1fr_.9fr] lg:items-center">
          <section>
            <SignalForgeLogo className="mb-8" markClassName="auth-brand-mark" />
            <p className="mb-4 text-xs font-semibold uppercase tracking-[.2em] text-accent">
              Investigate the failure. Prove the fix.
            </p>
            <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight text-ink md:text-5xl">
              Turn production signals into verified recovery.
            </h1>
            <p className="mt-5 max-w-lg leading-7 text-muted">
              Correlate telemetry, preserve the evidence, investigate with cited
              findings, and run a controlled check against the fix.
            </p>
            <div className="mt-8 flex flex-wrap gap-2 text-xs font-medium text-slate-600">
              <span className="rounded-full border border-line bg-white px-3 py-2">
                Event correlation
              </span>
              <span className="rounded-full border border-line bg-white px-3 py-2">
                Evidence-backed analysis
              </span>
              <span className="rounded-full border border-line bg-white px-3 py-2">
                Real verification
              </span>
            </div>
          </section>
          <section className="rounded-3xl border border-line bg-white p-7 shadow-panel md:p-9">
            <h2 className="text-2xl font-semibold">
              {authMode === "sign-in" ? "Welcome back" : "Create your account"}
            </h2>
            <p className="mt-2 text-sm text-muted">
              {authMode === "sign-in"
                ? "Sign in to your workspace."
                : "Start a SignalForge workspace."}
            </p>
            {error && (
              <p
                role="alert"
                className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700"
              >
                {error}
              </p>
            )}
            <form onSubmit={handleAuth} className="mt-6 space-y-4">
              {authMode === "sign-up" && (
                <label className="block text-sm font-medium">
                  Name
                  <input
                    required
                    name="name"
                    autoComplete="name"
                    className="field mt-2"
                  />
                </label>
              )}
              <label className="block text-sm font-medium">
                Email
                <input
                  required
                  type="email"
                  name="email"
                  autoComplete="email"
                  className="field mt-2"
                />
              </label>
              <label className="block text-sm font-medium">
                Password
                <input
                  required
                  minLength={12}
                  type="password"
                  name="password"
                  autoComplete={
                    authMode === "sign-in" ? "current-password" : "new-password"
                  }
                  className="field mt-2"
                />
                <span className="mt-1 block text-xs font-normal text-muted">
                  Use at least 12 characters.
                </span>
              </label>
              <button disabled={busy} className="button-primary w-full">
                {busy
                  ? "Please wait…"
                  : authMode === "sign-in"
                    ? "Sign in"
                    : "Create account"}
              </button>
            </form>
            <button
              className="mt-5 w-full text-sm font-medium text-accent hover:underline"
              onClick={() => {
                setAuthMode(authMode === "sign-in" ? "sign-up" : "sign-in");
                setError("");
              }}
            >
              {authMode === "sign-in"
                ? "New to SignalForge? Create an account"
                : "Already have an account? Sign in"}
            </button>
          </section>
        </div>
      </main>
    );

  if (!organizations.length)
    return (
      <main className="workspace min-h-screen px-5 py-12">
        <div className="mx-auto max-w-xl">
          <header className="mb-9 flex items-center justify-between">
            <a href="/" aria-label="SignalForge home">
              <SignalForgeLogo markClassName="auth-brand-mark" />
            </a>
            <button
              onClick={() => void signOut()}
              className="text-sm text-muted hover:text-ink"
            >
              Sign out
            </button>
          </header>
          <section className="rounded-3xl border border-line bg-white p-8 shadow-panel">
            <p className="text-xs font-semibold uppercase tracking-[.2em] text-accent">
              First step
            </p>
            <h1 className="mt-3 text-3xl font-semibold">
              Create your workspace
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted">
              This creates an organization, your first project, a staging
              environment, a demo service, two registered checks, and a one-time
              ingestion key.
            </p>
            {error && (
              <p
                role="alert"
                className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
              >
                {error}
              </p>
            )}
            <form onSubmit={handleOnboarding} className="mt-6 space-y-4">
              <label className="block text-sm font-medium">
                Organization name
                <input
                  required
                  name="organizationName"
                  className="field mt-2"
                  placeholder="Acme Engineering"
                />
              </label>
              <label className="block text-sm font-medium">
                Project name
                <input
                  required
                  name="projectName"
                  className="field mt-2"
                  placeholder="Checkout"
                />
              </label>
              <label className="block text-sm font-medium">
                Project slug
                <input
                  required
                  minLength={2}
                  maxLength={80}
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  name="projectSlug"
                  className="field mt-2"
                  placeholder="checkout"
                />
              </label>
              <button disabled={busy} className="button-primary w-full">
                {busy ? "Creating workspace…" : "Create workspace"}
              </button>
            </form>
          </section>
        </div>
      </main>
    );

  return (
    <div className="workspace min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1440px] items-center justify-between px-5 lg:px-8">
          <div className="flex items-center gap-3">
            <a
              href="/"
              className="flex items-center gap-3"
              aria-label="SignalForge home"
            >
              <SignalForgeLogo compact markClassName="workspace-brand-mark" />
              <div>
                <div className="text-sm font-semibold leading-4">
                  SignalForge
                </div>
                <div className="text-[11px] text-muted">
                  Incident intelligence
                </div>
              </div>
            </a>
          </div>
          <div className="flex items-center gap-3">
            <label className="sr-only" htmlFor="org-select">
              Organization
            </label>
            <select
              id="org-select"
              className="select max-w-[180px]"
              value={organizationId}
              onChange={(event) => {
                setOrganizationId(event.target.value);
                setIncidentId("");
                setOneTimeKey(null);
              }}
            >
              <option value="">Select organization</option>
              {organizations.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <div className="hidden text-right sm:block">
              <div className="text-xs font-medium">{actor.displayName}</div>
              <div className="text-[11px] text-muted">
                {organization?.role ?? "member"}
              </div>
            </div>
            <button
              onClick={() => void signOut()}
              disabled={busy}
              className="rounded-lg border border-line px-3 py-2 text-xs font-medium text-slate-600 hover:bg-canvas"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-5 py-7 lg:px-8">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.19em] text-accent">
              Operations
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              {view === "incidents"
                ? "Incident workspace"
                : view === "keys"
                  ? "Ingestion keys"
                  : view === "access"
                    ? "Organization access"
                    : view === "resources"
                      ? "Project resources"
                      : "Audit trail"}
            </h1>
            <p className="mt-2 text-sm text-muted">
              {project
                ? `${organization?.name ?? "Workspace"} / ${project.name}`
                : "Choose a project to get started."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {organization && ["owner", "admin"].includes(organization.role) && (
              <button
                onClick={() => setProjectFormOpen((open) => !open)}
                className="button-secondary"
              >
                {projectFormOpen ? "Close" : "New project"}
              </button>
            )}
            <label className="sr-only" htmlFor="project-select">
              Project
            </label>
            <select
              id="project-select"
              className="select min-w-[180px]"
              value={projectId}
              onChange={(event) => {
                setProjectId(event.target.value);
                setIncidentId("");
                setOneTimeKey(null);
              }}
            >
              {projects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <button
              onClick={() => setView("incidents")}
              className={`nav-button ${view === "incidents" ? "nav-active" : ""}`}
            >
              Incidents
            </button>
            <button
              onClick={() => setView("keys")}
              className={`nav-button ${view === "keys" ? "nav-active" : ""}`}
            >
              API keys
            </button>
            <button
              onClick={() => setView("resources")}
              className={`nav-button ${view === "resources" ? "nav-active" : ""}`}
            >
              Resources
            </button>
            {organization?.role !== "viewer" && (
              <button
                onClick={() => setView("access")}
                className={`nav-button ${view === "access" ? "nav-active" : ""}`}
              >
                Access
              </button>
            )}
            {organization && ["owner", "admin"].includes(organization.role) && (
              <button
                onClick={() => setView("audit")}
                className={`nav-button ${view === "audit" ? "nav-active" : ""}`}
              >
                Audit
              </button>
            )}
          </div>
        </div>
        {projectFormOpen && (
          <form
            onSubmit={(event) => void createProject(event)}
            className="panel mb-5 grid gap-3 p-5 md:grid-cols-[1fr_1fr_1.5fr_auto]"
          >
            <label className="text-xs font-medium">
              Name
              <input
                required
                name="projectName"
                className="field mt-2"
                placeholder="Payments API"
              />
            </label>
            <label className="text-xs font-medium">
              Slug
              <input
                required
                minLength={2}
                maxLength={80}
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                name="projectSlug"
                className="field mt-2"
                placeholder="payments-api"
              />
            </label>
            <label className="text-xs font-medium">
              Description
              <input
                maxLength={500}
                name="projectDescription"
                className="field mt-2"
                placeholder="Optional"
              />
            </label>
            <button disabled={busy} className="button-primary self-end">
              Create project
            </button>
          </form>
        )}
        {(error || message) && (
          <div
            className={`mb-5 flex items-start justify-between gap-4 rounded-xl px-4 py-3 text-sm ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}
            role={error ? "alert" : "status"}
          >
            <span>{error || message}</span>
            <button
              aria-label="Dismiss message"
              className="font-semibold"
              onClick={() => {
                setError("");
                setMessage("");
              }}
            >
              ×
            </button>
          </div>
        )}
        {oneTimeKey && (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-900">
              {oneTimeKey.name} — copy it now
            </div>
            <p className="mt-1 text-xs text-amber-800">
              This secret is displayed once. Store it in your service
              configuration.
            </p>
            <code className="mt-3 block overflow-auto rounded-lg bg-white px-3 py-2 text-xs text-ink">
              {oneTimeKey.plaintext}
            </code>
            <button
              className="mt-3 text-xs font-semibold text-amber-900 underline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(oneTimeKey.plaintext)
                  .then(() => setMessage("Key copied to clipboard."));
              }}
            >
              Copy key
            </button>
          </div>
        )}
        {invitationLink && view === "access" && (
          <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <div className="text-sm font-semibold text-amber-900">
              Invitation link — send it to the invited person
            </div>
            <p className="mt-1 text-xs text-amber-800">
              The token is shown once. Email delivery is not configured.
            </p>
            <code className="mt-3 block overflow-auto rounded-lg bg-white px-3 py-2 text-xs text-ink">
              {invitationLink}
            </code>
            <button
              className="mt-3 text-xs font-semibold text-amber-900 underline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(invitationLink)
                  .then(() => setMessage("Invitation link copied."));
              }}
            >
              Copy invitation link
            </button>
          </div>
        )}
        {!project && (
          <div className="rounded-2xl border border-line bg-white p-8 text-sm text-muted">
            No projects are available in this organization.
          </div>
        )}
        {project && view === "incidents" && (
          <div className="grid gap-5 xl:grid-cols-[minmax(300px,.85fr)_minmax(0,1.6fr)]">
            <section className="panel">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <div>
                  <h2 className="font-semibold">Incidents</h2>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${liveConnected ? "bg-emerald-500" : "bg-amber-400"}`}
                    />
                    {liveConnected
                      ? "Live updates connected"
                      : "Reconnecting · refresh fallback active"}
                  </p>
                </div>
                {canOperateIncidents && (
                  <button
                    disabled={busy}
                    onClick={() => void triggerFailure()}
                    className="button-primary !px-3 !py-2 text-xs"
                  >
                    Trigger synthetic failure
                  </button>
                )}
              </div>
              <div className="divide-y divide-line">
                {incidents.length === 0 ? (
                  <div className="px-5 py-12 text-center">
                    <div className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-emerald-50 text-xl text-mint">
                      ✓
                    </div>
                    <h3 className="mt-4 text-sm font-semibold">
                      No incidents yet
                    </h3>
                    <p className="mx-auto mt-2 max-w-[260px] text-xs leading-5 text-muted">
                      Trigger the synthetic checkout failure to walk through
                      correlation, investigation, and verification.
                    </p>
                  </div>
                ) : (
                  incidents.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setIncidentId(item.id)}
                      className={`block w-full px-5 py-4 text-left transition hover:bg-canvas ${incidentId === item.id ? "bg-blue-50/60" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold">
                            {item.title}
                          </div>
                          <div className="mt-1.5 text-xs text-muted">
                            {item.eventCount} event
                            {item.eventCount === 1 ? "" : "s"} · last seen{" "}
                            {dateTime(item.lastSeenAt)}
                          </div>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(item.status)}`}
                        >
                          {item.status}
                        </span>
                      </div>
                      <div className="mt-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${item.severity === "critical" || item.severity === "error" ? "bg-rose-500" : "bg-amber-400"}`}
                        />
                        {item.severity}
                        <span className="ml-auto font-normal normal-case tracking-normal">
                          {item.fingerprint.slice(0, 12)}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </section>
            <section className="space-y-5">
              {!detail ? (
                <div className="panel grid min-h-64 place-items-center p-8 text-sm text-muted">
                  Select an incident to inspect evidence and recovery.
                </div>
              ) : (
                <>
                  <article className="panel">
                    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-5">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(detail.incident.severity)}`}
                          >
                            {detail.incident.severity}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(detail.incident.status)}`}
                          >
                            {detail.incident.status}
                          </span>
                        </div>
                        <h2 className="mt-3 text-xl font-semibold">
                          {detail.incident.title}
                        </h2>
                        <p className="mt-1 text-xs text-muted">
                          First seen {dateTime(detail.incident.firstSeenAt)} ·{" "}
                          {detail.incident.eventCount} correlated event
                          {detail.incident.eventCount === 1 ? "" : "s"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {detail.incident.status === "open" && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void changeIncidentStatus("investigating")
                            }
                            className="button-secondary"
                          >
                            Start investigation
                          </button>
                        )}
                        {detail.incident.status === "investigating" && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void changeIncidentStatus("monitoring")
                            }
                            className="button-secondary"
                          >
                            Monitor
                          </button>
                        )}
                        {detail.incident.status !== "resolved" && (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void changeIncidentStatus("resolved")
                            }
                            className="button-secondary"
                          >
                            Resolve
                          </button>
                        )}
                        {detail.incident.status === "resolved" && (
                          <button
                            disabled={busy}
                            onClick={() => void changeIncidentStatus("open")}
                            className="button-secondary"
                          >
                            Reopen
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-0 divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
                      <div className="p-5">
                        <div className="section-label">Correlated events</div>
                        {incidentEvents.length === 0 &&
                        !incidentEventsLoading ? (
                          <p className="mt-3 text-xs text-muted">
                            No event details returned.
                          </p>
                        ) : (
                          <ul className="mt-3 space-y-3">
                            {incidentEvents.map((event) => (
                              <li
                                key={event.linkId}
                                className="rounded-xl bg-canvas p-3"
                              >
                                <div className="flex items-center justify-between gap-3">
                                  <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">
                                    {event.eventType} · {event.severity}
                                  </span>
                                  <time className="text-[10px] text-muted">
                                    {dateTime(event.occurredAt)}
                                  </time>
                                </div>
                                <p className="mt-2 text-xs leading-5">
                                  {event.message}
                                </p>
                                {event.traceId && (
                                  <p className="mt-2 truncate font-mono text-[10px] text-muted">
                                    trace {event.traceId}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        {incidentEventsLoading && (
                          <p className="mt-3 text-xs text-muted" role="status">
                            Loading incident events…
                          </p>
                        )}
                        {incidentEventsHasMore && (
                          <button
                            className="button-secondary mt-4 w-full"
                            disabled={incidentEventsLoading}
                            onClick={() => void loadMoreIncidentEvents()}
                          >
                            {incidentEventsLoading
                              ? "Loading…"
                              : "Load more events"}
                          </button>
                        )}
                      </div>
                      <div className="p-5">
                        <div className="section-label">Nearby deployments</div>
                        {detail.relatedDeployments.length === 0 ? (
                          <p className="mt-3 text-xs leading-5 text-muted">
                            No deployment was found in the correlation window.
                          </p>
                        ) : (
                          <ul className="mt-3 space-y-2">
                            {detail.relatedDeployments.map((deployment) => (
                              <li
                                key={deployment.id}
                                className="rounded-xl border border-line p-3"
                              >
                                <div className="text-xs font-semibold">
                                  {deployment.version}
                                </div>
                                <p className="mt-1 text-[10px] leading-4 text-muted">
                                  {deployment.relation}
                                </p>
                                <time className="mt-2 block text-[10px] text-muted">
                                  {dateTime(deployment.deployedAt)}
                                </time>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="mt-5 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-[10px] leading-4 text-muted">
                          A nearby deployment is temporal evidence. It does not
                          establish causation by itself.
                        </div>
                      </div>
                    </div>
                  </article>
                  <article className="panel">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                      <div>
                        <h3 className="font-semibold">Investigation</h3>
                        <p className="mt-1 text-xs text-muted">
                          Provider: {activeInvestigation?.provider ?? "not run"}
                          {activeInvestigation?.model
                            ? ` · ${activeInvestigation.model}`
                            : ""}
                        </p>
                      </div>
                      {canOperateIncidents && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={busy}
                            onClick={() => void createInvestigation()}
                            className="button-secondary"
                          >
                            {activeInvestigation &&
                            ["queued", "running"].includes(
                              activeInvestigation.status,
                            )
                              ? "Queue another run"
                              : "Investigate with evidence"}
                          </button>
                          {activeInvestigation?.status === "queued" && (
                            <button
                              disabled={busy}
                              onClick={() => void cancelInvestigation()}
                              className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            >
                              Cancel queued run
                            </button>
                          )}
                          {activeInvestigation?.status === "failed" &&
                            activeInvestigation.errorCode &&
                            retryableInvestigationErrors.has(
                              activeInvestigation.errorCode,
                            ) && (
                              <button
                                disabled={busy}
                                onClick={() => void retryInvestigation()}
                                className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                              >
                                Retry investigation
                              </button>
                            )}
                        </div>
                      )}
                    </div>
                    <div className="p-5">
                      {!activeInvestigation ? (
                        <p className="text-sm text-muted">
                          Run an investigation to collect persisted evidence and
                          produce cited hypotheses.
                        </p>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(activeInvestigation.status)}`}
                            >
                              {activeInvestigation.status}
                            </span>
                            <span className="text-[10px] text-muted">
                              Started {dateTime(activeInvestigation.createdAt)}
                            </span>
                          </div>
                          {activeInvestigation.summary && (
                            <p className="mt-4 text-sm leading-6">
                              {activeInvestigation.summary}
                            </p>
                          )}
                          {activeInvestigation.errorCode && (
                            <p className="mt-3 rounded-lg bg-rose-50 p-3 text-xs text-rose-700">
                              Investigation ended with{" "}
                              {activeInvestigation.errorCode}. The provider did
                              not return a completed analysis.
                            </p>
                          )}
                          {hypotheses.length > 0 && (
                            <div className="mt-5 space-y-3">
                              {hypotheses.map((hypothesis) => (
                                <div
                                  key={hypothesis.id}
                                  className="rounded-xl border border-line p-4"
                                >
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h4 className="text-sm font-semibold">
                                      {hypothesis.claim}
                                    </h4>
                                    <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-semibold uppercase text-blue-700">
                                      {hypothesis.confidence} confidence
                                    </span>
                                  </div>
                                  <p className="mt-2 text-xs leading-5 text-muted">
                                    {hypothesis.rationale}
                                  </p>
                                  <div className="mt-3 text-[10px] text-muted">
                                    Evidence references:{" "}
                                    {hypothesis.evidence.length
                                      ? hypothesis.evidence
                                          .map(
                                            (row) =>
                                              `${row.evidenceId.slice(0, 8)} (${row.relationship})`,
                                          )
                                          .join(", ")
                                      : "none"}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                          {evidence.length > 0 && (
                            <div className="mt-5">
                              <div className="section-label">
                                Persisted evidence ({evidence.length})
                              </div>
                              <div className="mt-2 grid gap-2 md:grid-cols-2">
                                {evidence.map((item) => (
                                  <details
                                    key={item.id}
                                    className="rounded-xl bg-canvas p-3"
                                  >
                                    <summary className="cursor-pointer text-xs font-semibold">
                                      {item.title}
                                      <span className="ml-2 font-normal text-muted">
                                        {item.sourceType}
                                      </span>
                                    </summary>
                                    <p className="mt-2 whitespace-pre-wrap text-[11px] leading-5 text-slate-600">
                                      {item.content}
                                    </p>
                                  </details>
                                ))}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </article>
                  <article className="panel">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                      <div>
                        <h3 className="font-semibold">Verification</h3>
                        <p className="mt-1 text-xs text-muted">
                          Registered checks run through the verification runner.
                        </p>
                      </div>
                      {canOperateIncidents && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={busy}
                            onClick={() =>
                              void createVerification("known-failure")
                            }
                            className="button-secondary"
                          >
                            Run failure check
                          </button>
                          <button
                            disabled={busy}
                            onClick={() =>
                              void createVerification("recovery-check")
                            }
                            className="button-primary !px-3 !py-2 text-xs"
                          >
                            Run recovery check
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="divide-y divide-line">
                      {verifications.length === 0 ? (
                        <p className="p-5 text-sm text-muted">
                          No verification has run for this incident.
                        </p>
                      ) : (
                        verifications.map((run) => (
                          <div key={run.id} className="p-5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="text-xs font-semibold">
                                Verification run{" "}
                                <span className="font-mono text-muted">
                                  {run.id.slice(0, 8)}
                                </span>
                              </div>
                              <span
                                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(run.status)}`}
                              >
                                {run.status}
                              </span>
                            </div>
                            {run.summary && (
                              <p className="mt-2 text-xs leading-5 text-muted">
                                {run.summary}
                              </p>
                            )}
                            {run.report?.assertions && (
                              <ul className="mt-3 space-y-2">
                                {run.report.assertions.map(
                                  (assertion, index) => (
                                    <li
                                      key={`${assertion.name}-${index}`}
                                      className="flex items-start gap-2 text-xs"
                                    >
                                      <span
                                        className={
                                          assertion.passed
                                            ? "text-emerald-600"
                                            : "text-rose-600"
                                        }
                                      >
                                        {assertion.passed ? "✓" : "×"}
                                      </span>
                                      <span>
                                        <strong>{assertion.name}</strong>
                                        <span className="ml-2 text-muted">
                                          Expected {assertion.expected}; got{" "}
                                          {assertion.actual}
                                        </span>
                                      </span>
                                    </li>
                                  ),
                                )}
                              </ul>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </article>
                </>
              )}
            </section>
          </div>
        )}
        {project && view === "keys" && (
          <section className="panel">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-5 py-5">
              <div>
                <h2 className="font-semibold">Project ingestion keys</h2>
                <p className="mt-1 text-xs text-muted">
                  Secrets are hashed at rest and shown only at creation.
                </p>
              </div>
              {organization &&
                ["owner", "admin"].includes(organization.role) && (
                  <form
                    onSubmit={(event) => void createKey(event)}
                    className="flex gap-2"
                  >
                    <input
                      name="keyName"
                      required
                      maxLength={100}
                      className="field !w-52"
                      placeholder="Key name"
                    />
                    <button
                      disabled={busy}
                      className="button-primary !px-3 !py-2 text-xs"
                    >
                      Create key
                    </button>
                  </form>
                )}
            </div>
            <div className="divide-y divide-line">
              {keys.length === 0 ? (
                <p className="p-8 text-sm text-muted">
                  No project keys have been created.
                </p>
              ) : (
                keys.map((key) => (
                  <div
                    key={key.id}
                    className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                  >
                    <div>
                      <div className="text-sm font-semibold">{key.name}</div>
                      <div className="mt-1 font-mono text-xs text-muted">
                        {key.keyPrefix}••••••••
                      </div>
                      <div className="mt-1 text-[10px] text-muted">
                        Created {dateTime(key.createdAt)} ·{" "}
                        {key.revokedAt
                          ? `revoked ${dateTime(key.revokedAt)}`
                          : key.lastUsedAt
                            ? `last used ${dateTime(key.lastUsedAt)}`
                            : "not used yet"}
                      </div>
                    </div>
                    {!key.revokedAt &&
                      organization &&
                      ["owner", "admin"].includes(organization.role) && (
                        <div className="flex gap-2">
                          <button
                            disabled={busy}
                            onClick={() => void rotateKey(key.id)}
                            className="rounded-lg border border-amber-200 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50"
                          >
                            Rotate key
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => void revokeKey(key.id)}
                            className="rounded-lg border border-rose-200 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50"
                          >
                            Revoke key
                          </button>
                        </div>
                      )}
                  </div>
                ))
              )}
            </div>
          </section>
        )}
        {project && view === "resources" && (
          <div className="grid gap-5 xl:grid-cols-2">
            <section className="panel">
              <div className="border-b border-line px-5 py-5">
                <h2 className="font-semibold">Environments</h2>
                <p className="mt-1 text-xs text-muted">
                  Deployment and telemetry environment names must match a
                  registered slug.
                </p>
              </div>
              {organization &&
                ["owner", "admin"].includes(organization.role) && (
                  <form
                    onSubmit={(event) => void createEnvironment(event)}
                    className="grid gap-2 border-b border-line p-5 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <label className="text-xs font-medium">
                      Name
                      <input
                        required
                        name="environmentName"
                        maxLength={100}
                        className="field mt-2"
                        placeholder="Production"
                      />
                    </label>
                    <label className="text-xs font-medium">
                      Slug
                      <input
                        required
                        name="environmentSlug"
                        minLength={2}
                        maxLength={80}
                        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                        className="field mt-2"
                        placeholder="production"
                      />
                    </label>
                    <button
                      disabled={busy}
                      className="button-primary self-end !px-3 !py-2 text-xs"
                    >
                      Add environment
                    </button>
                  </form>
                )}
              <ul className="divide-y divide-line">
                {environments.length === 0 ? (
                  <li className="p-5 text-sm text-muted">
                    No environments registered.
                  </li>
                ) : (
                  environments.map((environment) => (
                    <li
                      key={environment.id}
                      className="flex items-center justify-between gap-3 px-5 py-4"
                    >
                      <span className="text-sm font-medium">
                        {environment.name}
                      </span>
                      <code className="text-xs text-muted">
                        {environment.slug}
                      </code>
                    </li>
                  ))
                )}
              </ul>
            </section>
            <section className="panel">
              <div className="border-b border-line px-5 py-5">
                <h2 className="font-semibold">Services</h2>
                <p className="mt-1 text-xs text-muted">
                  Use the service key in telemetry events to associate them with
                  this resource.
                </p>
              </div>
              {organization &&
                ["owner", "admin"].includes(organization.role) && (
                  <form
                    onSubmit={(event) => void createService(event)}
                    className="grid gap-2 border-b border-line p-5 sm:grid-cols-2"
                  >
                    <label className="text-xs font-medium">
                      Name
                      <input
                        required
                        name="serviceName"
                        maxLength={100}
                        className="field mt-2"
                        placeholder="Payments API"
                      />
                    </label>
                    <label className="text-xs font-medium">
                      Service key
                      <input
                        required
                        name="serviceKey"
                        minLength={2}
                        maxLength={100}
                        pattern="[a-zA-Z0-9._-]+"
                        className="field mt-2"
                        placeholder="payments-api"
                      />
                    </label>
                    <label className="text-xs font-medium sm:col-span-2">
                      Description
                      <input
                        name="serviceDescription"
                        maxLength={500}
                        className="field mt-2"
                        placeholder="Optional"
                      />
                    </label>
                    <button
                      disabled={busy}
                      className="button-primary justify-self-start !px-3 !py-2 text-xs"
                    >
                      Add service
                    </button>
                  </form>
                )}
              <ul className="divide-y divide-line">
                {services.length === 0 ? (
                  <li className="p-5 text-sm text-muted">
                    No services registered.
                  </li>
                ) : (
                  services.map((service) => (
                    <li
                      key={service.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                    >
                      <span className="text-sm font-medium">
                        {service.name}
                      </span>
                      <code className="text-xs text-muted">
                        {service.serviceKey}
                      </code>
                    </li>
                  ))
                )}
              </ul>
            </section>
            <section className="panel xl:col-span-2">
              <div className="border-b border-line px-5 py-5">
                <h2 className="font-semibold">Deployment history</h2>
                <p className="mt-1 text-xs text-muted">
                  Deployment timing is useful context for an incident; proximity
                  alone does not establish cause.
                </p>
              </div>
              {organization &&
                ["owner", "admin"].includes(organization.role) && (
                  <form
                    onSubmit={(event) => void createDeployment(event)}
                    className="grid gap-3 border-b border-line p-5 md:grid-cols-[1fr_1fr_1fr_1fr_auto]"
                  >
                    <label className="text-xs font-medium">
                      Environment
                      <select
                        required
                        name="environmentId"
                        className="select mt-2 w-full"
                        defaultValue=""
                      >
                        <option value="" disabled>
                          Select environment
                        </option>
                        {environments.map((environment) => (
                          <option key={environment.id} value={environment.id}>
                            {environment.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium">
                      Version
                      <input
                        required
                        name="deploymentVersion"
                        maxLength={120}
                        className="field mt-2"
                        placeholder="v1.2.3"
                      />
                    </label>
                    <label className="text-xs font-medium">
                      Commit SHA
                      <input
                        name="commitSha"
                        maxLength={100}
                        className="field mt-2"
                        placeholder="Optional"
                      />
                    </label>
                    <label className="text-xs font-medium">
                      Status
                      <select
                        name="deploymentStatus"
                        className="select mt-2 w-full"
                        defaultValue="succeeded"
                      >
                        <option value="started">Started</option>
                        <option value="succeeded">Succeeded</option>
                        <option value="failed">Failed</option>
                        <option value="rolled_back">Rolled back</option>
                        <option value="unknown">Unknown</option>
                      </select>
                    </label>
                    <button
                      disabled={busy || environments.length === 0}
                      className="button-primary self-end !px-3 !py-2 text-xs"
                    >
                      Record deployment
                    </button>
                  </form>
                )}
              <div className="divide-y divide-line">
                {deployments.length === 0 ? (
                  <p className="p-5 text-sm text-muted">
                    No deployments have been recorded.
                  </p>
                ) : (
                  deployments.map((deployment) => (
                    <div
                      key={deployment.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                    >
                      <div>
                        <div className="text-sm font-medium">
                          {deployment.version}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {deployment.commitSha
                            ? `Commit ${deployment.commitSha} · `
                            : ""}
                          {dateTime(deployment.deployedAt)}
                        </div>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(deployment.status)}`}
                      >
                        {deployment.status.replaceAll("_", " ")}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
        {view === "audit" && (
          <section className="panel">
            <div className="border-b border-line px-5 py-5">
              <h2 className="font-semibold">Organization audit trail</h2>
              <p className="mt-1 text-xs text-muted">
                Recent administrative and security-sensitive actions. Secret
                values are not included.
              </p>
            </div>
            <div className="divide-y divide-line">
              {auditRecords.length === 0 ? (
                <p className="p-8 text-sm text-muted">
                  No audit records were returned.
                </p>
              ) : (
                auditRecords.map((record) => (
                  <div
                    key={record.id}
                    className="grid gap-2 px-5 py-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-center"
                  >
                    <div>
                      <div className="text-sm font-semibold">
                        {record.action}
                      </div>
                      <div className="mt-1 text-xs text-muted">
                        {dateTime(record.createdAt)} · {record.outcome}
                      </div>
                    </div>
                    <div className="text-xs">
                      <span className="text-muted">{record.resourceType}</span>
                      {record.resourceId && (
                        <code className="ml-2 text-muted">
                          {record.resourceId}
                        </code>
                      )}
                    </div>
                    <div className="text-xs text-muted">
                      Actor {record.actorUserId ?? "system"}
                    </div>
                    {record.requestId && (
                      <code className="text-[10px] text-muted">
                        Request {record.requestId}
                      </code>
                    )}
                  </div>
                ))
              )}
            </div>
          </section>
        )}
        {view === "access" && (
          <div className="grid gap-5 xl:grid-cols-2">
            <section className="panel">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-5">
                <div>
                  <h2 className="font-semibold">Members</h2>
                  <p className="mt-1 text-xs text-muted">
                    Role checks are enforced by the API.
                  </p>
                </div>
                {organization &&
                  ["owner", "admin"].includes(organization.role) && (
                    <form
                      onSubmit={(event) => void createInvitation(event)}
                      className="flex flex-wrap gap-2"
                    >
                      <input
                        name="inviteEmail"
                        required
                        type="email"
                        className="field !w-52"
                        placeholder="person@example.com"
                      />
                      <select name="inviteRole" className="select">
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                        {organization.role === "owner" && (
                          <option value="admin">Admin</option>
                        )}
                      </select>
                      <button
                        disabled={busy}
                        className="button-primary !px-3 !py-2 text-xs"
                      >
                        Invite
                      </button>
                    </form>
                  )}
              </div>
              <div className="divide-y divide-line">
                {members.length === 0 ? (
                  <p className="p-8 text-sm text-muted">
                    No members were returned.
                  </p>
                ) : (
                  members.map((item) => (
                    <div
                      key={item.userId}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">
                          {item.name}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {item.email}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {organization &&
                        ["owner", "admin"].includes(organization.role) ? (
                          <select
                            aria-label={`Role for ${item.email}`}
                            className="select"
                            value={item.role}
                            disabled={
                              busy ||
                              (item.role === "owner" &&
                                organization.role !== "owner")
                            }
                            onChange={(event) =>
                              void updateMemberRole(
                                item.userId,
                                event.target
                                  .value as OrganizationMember["role"],
                              )
                            }
                          >
                            <option
                              value="owner"
                              disabled={organization.role !== "owner"}
                            >
                              Owner
                            </option>
                            <option value="admin">Admin</option>
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        ) : (
                          <span className="text-xs text-muted">
                            {item.role}
                          </span>
                        )}
                        {organization &&
                          ["owner", "admin"].includes(organization.role) &&
                          item.role !== "owner" && (
                            <button
                              disabled={busy}
                              onClick={() => void removeMember(item.userId)}
                              className="text-xs font-medium text-rose-700"
                            >
                              Remove
                            </button>
                          )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
            <section className="panel">
              <div className="border-b border-line px-5 py-5">
                <h2 className="font-semibold">Invitations</h2>
                <p className="mt-1 text-xs text-muted">
                  Invitation links expire after seven days and can be revoked.
                </p>
              </div>
              <div className="divide-y divide-line">
                {invitations.length === 0 ? (
                  <p className="p-8 text-sm text-muted">
                    No invitations found.
                  </p>
                ) : (
                  invitations.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
                    >
                      <div>
                        <div className="text-sm font-semibold">
                          {item.email}
                        </div>
                        <div className="mt-1 text-xs text-muted">
                          {item.role} · expires {dateTime(item.expiresAt)} ·{" "}
                          {item.acceptedAt
                            ? "accepted"
                            : item.revokedAt
                              ? "revoked"
                              : "pending"}
                        </div>
                      </div>
                      {!item.acceptedAt &&
                        !item.revokedAt &&
                        organization &&
                        ["owner", "admin"].includes(organization.role) && (
                          <button
                            disabled={busy}
                            onClick={() => void revokeInvitation(item.id)}
                            className="text-xs font-medium text-rose-700"
                          >
                            Revoke
                          </button>
                        )}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-line py-4 text-[10px] text-muted">
          <span>
            SignalForge demo data is labeled synthetic. AI output is
            provider-labelled; deployment proximity does not prove causation.
          </span>
          <span>{actor.email}</span>
        </footer>
      </main>
    </div>
  );
}
