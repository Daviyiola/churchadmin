export type OrganizationRole =
  | "owner"
  | "admin"
  | "finance"
  | "viewer"
  | "member";

export function canSendFollowupEmail(
  role: string | null | undefined,
): role is "owner" | "admin" | "finance" {
  return role === "owner" || role === "admin" || role === "finance";
}

export function canSendBroadcastEmail(
  role: string | null | undefined,
): role is "owner" | "admin" | "finance" {
  return role === "owner" || role === "admin" || role === "finance";
}

export function canSendMemberGivingEmail(
  role: string | null | undefined,
): role is "owner" | "admin" {
  return role === "owner" || role === "admin";
}
