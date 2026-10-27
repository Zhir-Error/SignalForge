import { describe, expect, it } from "vitest";
import {
  ApiError,
  requireRole,
  type MemberContext,
} from "../apps/api/src/security.js";

const memberWithRole = (role: MemberContext["role"]): MemberContext => ({
  actor: {
    userId: "user-1",
    email: "member@example.test",
    displayName: "Workspace Member",
  },
  organizationId: "organization-1",
  role,
});

describe("organization role checks", () => {
  it("allows viewers to read while blocking member-only actions", () => {
    const viewer = memberWithRole("viewer");
    expect(() => requireRole(viewer, "viewer")).not.toThrow();
    expect(() => requireRole(viewer, "member")).toThrow(ApiError);
  });

  it("allows members to use incident actions but not administration", () => {
    const member = memberWithRole("member");
    expect(() => requireRole(member, "member")).not.toThrow();
    expect(() => requireRole(member, "admin")).toThrow(ApiError);
  });
});
