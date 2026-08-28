import { NextResponse } from "next/server";
import { requireUser, requireOrgFinanceOrAbove, requireOrgOwnerOrAdmin } from "@/lib/serverAuthz";
import { ensureEmailContact, getEmailPreferenceContact, resolveEmailEligibility, setEmailPreferences, CHURCH_EMAIL_TOPICS, type ChurchEmailTopic } from "@/lib/server/email";

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  const url = new URL(request.url);
  const orgId = url.searchParams.get("organization_id") || "";
  const email = url.searchParams.get("email") || "";
  const memberId = url.searchParams.get("member_id") || null;
  const auth = await requireOrgFinanceOrAbove(orgId, user.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const contact = await ensureEmailContact(orgId, email, memberId);
    const state = await getEmailPreferenceContact(contact.id);
    const eligibility = await Promise.all(CHURCH_EMAIL_TOPICS.map(async (topic) => [topic, await resolveEmailEligibility(orgId, email, topic, memberId)] as const));
    return NextResponse.json({ contact: state, eligibility: Object.fromEntries(eligibility) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load email preferences." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user.ok) return NextResponse.json({ error: user.error }, { status: user.status });
  const body = await request.json().catch(() => null) as { organization_id?: unknown; email?: unknown; member_id?: unknown; topics?: unknown; subscribed?: unknown; reason?: unknown } | null;
  const orgId = typeof body?.organization_id === "string" ? body.organization_id : "";
  const email = typeof body?.email === "string" ? body.email : "";
  const memberId = typeof body?.member_id === "string" ? body.member_id : null;
  const topics = Array.isArray(body?.topics) ? body.topics.filter((topic): topic is ChurchEmailTopic => typeof topic === "string" && CHURCH_EMAIL_TOPICS.includes(topic as ChurchEmailTopic)) : [];
  const subscribed = body?.subscribed === true;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const auth = subscribed ? await requireOrgOwnerOrAdmin(orgId, user.userId) : await requireOrgFinanceOrAbove(orgId, user.userId);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!topics.length) return NextResponse.json({ error: "Choose at least one email category." }, { status: 400 });
  if (subscribed && !reason) return NextResponse.json({ error: "An affirmative-consent reason is required to resubscribe." }, { status: 400 });
  try {
    const contact = await ensureEmailContact(orgId, email, memberId);
    const updated = await setEmailPreferences({ contactId: contact.id, topics, subscribed, source: "staff", actorId: user.userId, reason: reason || "Suppressed by organization staff" });
    return NextResponse.json({ ok: true, contact: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update email preferences." }, { status: 400 });
  }
}
