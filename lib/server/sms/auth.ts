import { requireOrgFinanceOrAbove, requireUser } from "@/lib/serverAuthz";

export async function requireSmsOperator(req: Request, orgId: string) {
  const user = await requireUser(req);
  if (!user.ok) throw Object.assign(new Error(user.error), { status: user.status });
  const access = await requireOrgFinanceOrAbove(orgId, user.userId);
  if (!access.ok) throw Object.assign(new Error(access.error), { status: access.status });
  return { userId: user.userId, role: access.role };
}

export function smsRouteError(error: unknown) {
  const status = typeof error === "object" && error && "status" in error
    ? Number((error as { status: unknown }).status)
    : 400;
  return { status: [401, 403, 404].includes(status) ? status : 400, message: error instanceof Error ? error.message : "Unable to complete the SMS request." };
}
