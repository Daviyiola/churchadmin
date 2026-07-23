import { describe, expect, it } from "vitest";
import {
  canSendBroadcastEmail,
  canSendFollowupEmail,
  canSendMemberGivingEmail,
  type OrganizationRole,
} from "@/lib/emailPermissions";

const roles: OrganizationRole[] = [
  "owner",
  "admin",
  "finance",
  "viewer",
  "member",
];

describe("email permissions", () => {
  it.each(["owner", "admin", "finance"] as OrganizationRole[])(
    "allows %s to send ordinary follow-ups and broadcasts",
    (role) => {
      expect(canSendFollowupEmail(role)).toBe(true);
      expect(canSendBroadcastEmail(role)).toBe(true);
    },
  );

  it.each(["viewer", "member"] as OrganizationRole[])(
    "blocks %s from sending follow-ups and broadcasts",
    (role) => {
      expect(canSendFollowupEmail(role)).toBe(false);
      expect(canSendBroadcastEmail(role)).toBe(false);
    },
  );

  it("keeps Member Giving email restricted to owners and admins", () => {
    const allowed = roles.filter(canSendMemberGivingEmail);
    expect(allowed).toEqual(["owner", "admin"]);
    expect(canSendMemberGivingEmail("finance")).toBe(false);
  });
});
