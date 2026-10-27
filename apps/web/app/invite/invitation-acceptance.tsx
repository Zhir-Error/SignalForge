"use client";

import { FormEvent, useEffect, useState } from "react";
import { SignalForgeLogo } from "../signalforge-logo";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined)
    headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
    cache: "no-store",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message =
      isObject(payload) &&
      isObject(payload.error) &&
      typeof payload.error.message === "string"
        ? payload.error.message
        : `Request failed (${response.status}).`;
    throw new Error(message);
  }
  if (isObject(payload) && "data" in payload) return payload.data as T;
  return payload as T;
}

export default function InvitationAcceptance({ token }: { token: string }) {
  const [invitationToken, setInvitationToken] = useState(token);
  const [authenticated, setAuthenticated] = useState(false);
  const [checked, setChecked] = useState(false);
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!token && window.location.hash.startsWith("#token=")) {
      try {
        setInvitationToken(
          decodeURIComponent(window.location.hash.slice("#token=".length)),
        );
      } catch {
        setError("The invitation link is malformed.");
      }
      window.history.replaceState(null, "", window.location.pathname);
    }
    void request("/v1/me")
      .then(() => {
        if (!cancelled) setAuthenticated(true);
      })
      .catch(() => {
        if (!cancelled) setAuthenticated(false);
      })
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept() {
    if (!invitationToken) {
      setError("This invitation link does not contain a token.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await request<{ organizationId: string; role: string }>(
        "/v1/invitations/accept",
        { method: "POST", body: JSON.stringify({ token: invitationToken }) },
      );
      setMessage(
        `Invitation accepted. You joined organization ${result.organizationId} as ${result.role}.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This invitation could not be accepted.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const body = {
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      ...(mode === "sign-up" ? { name: String(form.get("name") ?? "") } : {}),
    };
    try {
      await request(
        `/api/auth/${mode === "sign-up" ? "sign-up" : "sign-in"}/email`,
        { method: "POST", body: JSON.stringify(body) },
      );
      setAuthenticated(true);
      await accept();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Authentication failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="workspace grid min-h-screen place-items-center px-5 py-10">
      <section className="w-full max-w-lg rounded-3xl border border-line bg-white p-8 shadow-panel">
        <a href="/" aria-label="SignalForge home" className="inline-flex">
          <SignalForgeLogo markClassName="auth-brand-mark" />
        </a>
        <p className="mt-8 text-xs font-semibold uppercase tracking-[.2em] text-accent">
          Organization invitation
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Join a workspace</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          Sign in with the email address the invitation was sent to, then accept
          it.
        </p>
        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
          >
            {error}
          </p>
        )}
        {message && (
          <p
            role="status"
            className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
          >
            {message}
            <a href="/" className="ml-2 font-semibold underline">
              Open workspace
            </a>
          </p>
        )}
        {!checked ? (
          <p className="mt-6 text-sm text-muted">Checking your session…</p>
        ) : authenticated ? (
          !message && (
            <button
              disabled={busy}
              onClick={() => void accept()}
              className="button-primary mt-6 w-full"
            >
              {busy ? "Accepting…" : "Accept invitation"}
            </button>
          )
        ) : (
          <>
            <form
              onSubmit={(event) => void authenticate(event)}
              className="mt-6 space-y-4"
            >
              {mode === "sign-up" && (
                <label className="block text-sm font-medium">
                  Name
                  <input
                    name="name"
                    required
                    autoComplete="name"
                    className="field mt-2"
                  />
                </label>
              )}
              <label className="block text-sm font-medium">
                Email
                <input
                  name="email"
                  required
                  type="email"
                  autoComplete="email"
                  className="field mt-2"
                />
              </label>
              <label className="block text-sm font-medium">
                Password
                <input
                  name="password"
                  required
                  minLength={12}
                  type="password"
                  autoComplete={
                    mode === "sign-in" ? "current-password" : "new-password"
                  }
                  className="field mt-2"
                />
              </label>
              <button disabled={busy} className="button-primary w-full">
                {busy
                  ? "Please wait…"
                  : mode === "sign-in"
                    ? "Sign in and accept"
                    : "Create account and accept"}
              </button>
            </form>
            <button
              className="mt-5 w-full text-sm font-medium text-accent"
              onClick={() =>
                setMode(mode === "sign-in" ? "sign-up" : "sign-in")
              }
            >
              {mode === "sign-in"
                ? "Create an account instead"
                : "Already have an account? Sign in"}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
