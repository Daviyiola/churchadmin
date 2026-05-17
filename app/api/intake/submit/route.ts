import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ErrorJson = { error: string };

type Gender = "male" | "female";
type AgeGroup = "1-12" | "13-17" | "18-35" | "36+";
type Segment = "men" | "women" | "boys" | "girls";

function isGender(v: unknown): v is Gender {
  return v === "male" || v === "female";
}
function isAgeGroup(v: unknown): v is AgeGroup {
  return v === "1-12" || v === "13-17" || v === "18-35" || v === "36+";
}
function computeSegment(g: Gender, ag: AgeGroup): Segment {
  const under18 = ag === "1-12" || ag === "13-17";
  if (under18) return g === "male" ? "boys" : "girls";
  return g === "male" ? "men" : "women";
}
function cleanStr(v: unknown) {
  return String(v ?? "").trim();
}
function cleanEmail(v: unknown) {
  return cleanStr(v).toLowerCase();
}
function isValidEmail(v: string) {
  return v.includes("@") && v.includes(".");
}
function cleanStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const clean = v.map((x) => cleanStr(x)).filter(Boolean);
  return clean.length ? clean : null;
}
function todayISODate() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

const DEFAULT_FOLLOWUP_STEPS = [
  {
    dayOffset: 0,
    label: "Day 0: Thank you for visiting",
    subject: "Thank you for visiting {churchName}",
    body: "Hi {firstName},\n\nThank you for visiting {churchName}. It was a blessing to have you with us.\n\nWe hope you felt welcomed, and we would love to see you again soon.\n\nBlessings,\n{churchName}",
  },
  {
    dayOffset: 3,
    label: "Day 3: Hope to see you again",
    subject: "We hope to see you again soon",
    body: "Hi {firstName},\n\nWe just wanted to check in and say we were glad you visited {churchName}.\n\nIf you have any questions or prayer requests, feel free to reply to this email.\n\nBlessings,\n{churchName}",
  },
  {
    dayOffset: 7,
    label: "Day 7: Invite to community group",
    subject: "Would you like to connect with a group?",
    body: "Hi {firstName},\n\nWe would love to help you get more connected at {churchName}.\n\nIf you are interested, we can share more information about our community groups, ministries, or next steps.\n\nBlessings,\n{churchName}",
  },
  {
    dayOffset: 14,
    label: "Day 14: Pastoral check-in",
    subject: "Checking in from {churchName}",
    body: "Hi {firstName},\n\nWe wanted to check in again and let you know we are grateful you visited {churchName}.\n\nPlease let us know if there is any way we can pray for you or support you.\n\nBlessings,\n{churchName}",
  },
];

function fillTemplate(template: string, vars: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

function makeScheduledForISO(
  firstVisitISODate: string,
  dayOffset: number,
  sendTime: string,
) {
  const [hhRaw, mmRaw] = sendTime.split(":");
  const hh = Number(hhRaw);
  const mm = Number(mmRaw);

  const base = new Date(`${firstVisitISODate}T00:00:00`);
  base.setDate(base.getDate() + dayOffset);
  base.setHours(
    Number.isFinite(hh) ? hh : 18,
    Number.isFinite(mm) ? mm : 0,
    0,
    0,
  );

  return base.toISOString();
}

export async function POST(req: Request) {
  const bodyUnknown: unknown = await req.json().catch(() => null);
  if (!bodyUnknown || typeof bodyUnknown !== "object") {
    return NextResponse.json<ErrorJson>(
      { error: "Invalid payload" },
      { status: 400 },
    );
  }
  const body = bodyUnknown as Record<string, unknown>;

  const token = cleanStr(body.token);
  if (!token) {
    return NextResponse.json<ErrorJson>(
      { error: "Missing token" },
      { status: 400 },
    );
  }

  // Collect fields (now includes editable identity)
  const firstName = cleanStr(body.first_name);
  const email = cleanEmail(body.email);

  const lastName = cleanStr(body.last_name);
  const phone = cleanStr(body.phone);
  const address = cleanStr(body.address);
  const maritalStatus = cleanStr(body.marital_status);
  const howHeard = cleanStr(body.how_heard);

  const genderRaw = body.gender;
  const ageRaw = body.age_group;
  const gender = isGender(genderRaw) ? genderRaw : null;
  const ageGroup = isAgeGroup(ageRaw) ? ageRaw : null;

  const childrenRaw = cleanStr(body.children_count);
  const children_count = childrenRaw === "" ? null : Number(childrenRaw);

  if (
    children_count !== null &&
    (!Number.isFinite(children_count) || children_count < 0)
  ) {
    return NextResponse.json(
      { error: "Children count must be a valid non-negative number." },
      { status: 400 },
    );
  }

  const prayerTags = cleanStringArray(body.prayer_request_tags);

  // Validate
  if (!firstName)
    return NextResponse.json<ErrorJson>(
      { error: "First name is required." },
      { status: 400 },
    );
  if (!email || !isValidEmail(email))
    return NextResponse.json<ErrorJson>(
      { error: "A valid email is required." },
      { status: 400 },
    );

  if (!lastName)
    return NextResponse.json<ErrorJson>(
      { error: "Last name is required." },
      { status: 400 },
    );
  if (!gender)
    return NextResponse.json<ErrorJson>(
      { error: "Gender is required." },
      { status: 400 },
    );
  if (!ageGroup)
    return NextResponse.json<ErrorJson>(
      { error: "Age group is required." },
      { status: 400 },
    );
  if (!phone)
    return NextResponse.json<ErrorJson>(
      { error: "Phone is required." },
      { status: 400 },
    );

  if (
    children_count !== null &&
    (!Number.isFinite(children_count) || children_count < 0)
  ) {
    return NextResponse.json<ErrorJson>(
      { error: "Children count must be a valid non-negative number." },
      { status: 400 },
    );
  }

  // 1) Validate token
  const { data: tok, error: tokErr } = await supabaseAdmin
    .from("intake_tokens")
    .select("token,org_id,member_id,expires_at,used_at")
    .eq("token", token)
    .maybeSingle();

  if (tokErr)
    return NextResponse.json<ErrorJson>(
      { error: tokErr.message },
      { status: 400 },
    );
  if (!tok)
    return NextResponse.json<ErrorJson>(
      { error: "Invalid link" },
      { status: 404 },
    );

  if (tok.used_at) {
    return NextResponse.json<ErrorJson>(
      { error: "This link has already been used." },
      { status: 410 },
    );
  }
  if (new Date(tok.expires_at).getTime() < Date.now()) {
    return NextResponse.json<ErrorJson>(
      { error: "This link has expired." },
      { status: 410 },
    );
  }

  // 2) Race-safe consume FIRST (prevents double submits)
  const now = new Date().toISOString();

  const { data: consumedRows, error: consumeErr } = await supabaseAdmin
    .from("intake_tokens")
    .update({ used_at: now })
    .eq("token", token)
    .is("used_at", null)
    .gt("expires_at", now)
    .select("token");

  if (consumeErr)
    return NextResponse.json<ErrorJson>(
      { error: consumeErr.message },
      { status: 400 },
    );

  if (!consumedRows || consumedRows.length === 0) {
    // either expired or already used (race) — give the user a friendly message
    return NextResponse.json<ErrorJson>(
      { error: "This link has already been used or expired." },
      { status: 410 },
    );
  }

  // 3) Ensure member belongs to org (defense-in-depth)
  const { data: mem, error: memErr } = await supabaseAdmin
    .from("members")
    .select("id,org_id")
    .eq("id", tok.member_id)
    .maybeSingle();

  if (memErr)
    return NextResponse.json<ErrorJson>(
      { error: memErr.message },
      { status: 400 },
    );
  if (!mem || mem.org_id !== tok.org_id) {
    return NextResponse.json<ErrorJson>(
      { error: "Invalid link" },
      { status: 404 },
    );
  }

  const seg = computeSegment(gender, ageGroup);

  // 4) Update members + upsert visitor_details
  const firstVisit = todayISODate();

  const [{ error: upMemErr }, { error: upVdErr }] = await Promise.all([
    supabaseAdmin
      .from("members")
      .update({
        first_name: firstName,
        email,

        last_name: lastName,
        phone,
        address,
        marital_status: maritalStatus,
        children_count: children_count,

        gender,
        age_group: ageGroup,
        segment: seg,

        membership_stage: "visitor",
        profile_complete: true,
        updated_at: now,
      })
      .eq("id", tok.member_id)
      .eq("org_id", tok.org_id),

    // upsert visitor details; keep first_visit_at if it already exists
    supabaseAdmin.from("visitor_details").upsert(
      {
        member_id: tok.member_id,
        how_heard: howHeard || null,
        prayer_request_tags: prayerTags,
        updated_at: now,
        // setting this on upsert is ok if you don't mind overwriting,
        // but we want "first visit" to stay the first visit:
        // we'll set it only on insert using a second step below
      },
      { onConflict: "member_id" },
    ),
  ]);

  if (upMemErr)
    return NextResponse.json<ErrorJson>(
      { error: upMemErr.message },
      { status: 400 },
    );
  if (upVdErr)
    return NextResponse.json<ErrorJson>(
      { error: upVdErr.message },
      { status: 400 },
    );

  // 5) Ensure first_visit_at is set (only if null)
  // (cheap + safe; avoids overwriting an existing first_visit_at)
  await supabaseAdmin
    .from("visitor_details")
    .update({ first_visit_at: firstVisit })
    .eq("member_id", tok.member_id)
    .is("first_visit_at", null);

  // 6) If automation is enabled, create default scheduled follow-ups.
  // No rows are created if automation is off.
  // No quota is consumed here; quota is only consumed when messages actually send.
  try {
    const { data: settings } = await supabaseAdmin
      .from("followup_settings")
      .select("automation_enabled,default_reply_to,send_time")
      .eq("org_id", tok.org_id)
      .maybeSingle<{
        automation_enabled: boolean;
        default_reply_to: string | null;
        send_time: string | null;
      }>();

    if (settings?.automation_enabled && email) {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("name")
        .eq("id", tok.org_id)
        .maybeSingle<{ name: string | null }>();

      const churchName =
        String(org?.name ?? "Our Church").trim() || "Our Church";

      const vars = {
        firstName,
        lastName,
        churchName,
      };

      const sendTime = settings.send_time || "18:00:00";

      const rowsToInsert = DEFAULT_FOLLOWUP_STEPS.map((step) => ({
        org_id: tok.org_id,
        member_id: tok.member_id,
        channel: "email",
        followup_label: step.label,
        day_offset: step.dayOffset,
        scheduled_for: makeScheduledForISO(
          firstVisit,
          step.dayOffset,
          sendTime,
        ),
        subject: fillTemplate(step.subject, vars),
        body: fillTemplate(step.body, vars),
        reply_to: settings.default_reply_to || null,
        status: "pending",
      }));

      await supabaseAdmin.from("scheduled_followups").upsert(rowsToInsert, {
        onConflict: "org_id,member_id,day_offset",
        ignoreDuplicates: true,
      });
    }
  } catch {
    // Do not fail the visitor form if scheduling fails.
    // The visitor record is more important than the automation side-effect.
  }

  return NextResponse.json({ ok: true });
}
