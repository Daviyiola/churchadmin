// app/api/reports/first-timers/run/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBearerToken, getReportRequestContext, reportErrorStatus } from "@/lib/server/reports/requestSupabase";

import type {
  RunFirstTimersBody,
  FirstTimersReport,
  ErrorResponse,
  Role,
  Branding,
  Gender,
  AgeGroup,
  JoinedFilter,
  FirstTimersDetailRow,
} from "@/lib/reports/first-timers/types";

type OrgRow = { id: string; name: string };

type OrgSettingsRow = {
  organization_id: string;
  logo_path: string | null;
  use_default_logo: boolean;
  report_header_text: string | null;
  report_subheader_text: string | null;
};

type VisitorDetailsRow = {
  first_visit_at: string | null;
  follow_up_status:
    | "new"
    | "contacted"
    | "scheduled"
    | "visited_again"
    | "joined"
    | null;
  follow_up_notes: string | null;
  how_heard: string | null;
};

type RawRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  gender: Gender | null;
  age_group: AgeGroup | null;
  status: "active" | "archived";
  membership_stage: string;
  visitor_details: VisitorDetailsRow | VisitorDetailsRow[] | null;
};

function asRole(raw: unknown): Role {
  const v = String(raw);
  if (v === "owner" || v === "admin" || v === "finance" || v === "member" || v === "viewer")
    return v;
  return "member";
}

function isYmd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isGender(v: unknown): v is Gender {
  return v === "male" || v === "female";
}

function isAgeGroup(v: unknown): v is AgeGroup {
  return v === "1-12" || v === "13-17" || v === "18-35" || v === "36+";
}

function isJoinedFilter(v: unknown): v is JoinedFilter {
  return v === "all" || v === "joined" || v === "not_joined";
}

function safeName(first: string | null, last: string | null) {
  return `${first ?? ""} ${last ?? ""}`.trim() || "—";
}

function demoLabel(g: Gender | null, a: AgeGroup | null) {
  if (!g && !a) return "—";
  const gLabel = g ? (g === "male" ? "Male" : "Female") : "—";
  const aLabel = a ?? "—";
  return `${gLabel} · ${aLabel}`;
}

async function getBranding(supabase: SupabaseClient, orgId: string): Promise<Branding> {
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("id,name")
    .eq("id", orgId)
    .maybeSingle();

  if (orgErr) throw new Error(orgErr.message);

  const { data: s, error: sErr } = await supabase
    .from("organization_settings")
    .select("organization_id,logo_path,use_default_logo,report_header_text,report_subheader_text")
    .eq("organization_id", orgId)
    .maybeSingle();

  if (sErr) throw new Error(sErr.message);

  const settings = (s ?? null) as OrgSettingsRow | null;

  let logo_url: string | null = null;
  if (settings && !settings.use_default_logo && settings.logo_path) {
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from("org-logos")
      .createSignedUrl(settings.logo_path, 60 * 60);

    if (signErr) throw new Error(signErr.message);
    logo_url = signed?.signedUrl ?? null;
  }

  const orgName = (org as OrgRow | null)?.name ?? "Organization";

  return {
    logo_url,
    header_text: settings?.report_header_text ?? orgName,
    subheader_text: settings?.report_subheader_text ?? "First-timers report",
    generated_at_iso: new Date().toISOString(),
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RunFirstTimersBody;

    if (!body.organization_id || !body.start_date || !body.end_date) {
      return NextResponse.json(
        { error: "organization_id, start_date, end_date are required" } satisfies ErrorResponse,
        { status: 400 }
      );
    }

    if (!isYmd(body.start_date) || !isYmd(body.end_date)) {
      return NextResponse.json(
        { error: "start_date and end_date must be YYYY-MM-DD" } satisfies ErrorResponse,
        { status: 400 }
      );
    }

    if (body.end_date < body.start_date) {
      return NextResponse.json(
        { error: "end_date cannot be earlier than start_date" } satisfies ErrorResponse,
        { status: 400 }
      );
    }

    const include_archived = typeof body.include_archived === "boolean" ? body.include_archived : true;
    const joined: JoinedFilter = isJoinedFilter(body.joined) ? body.joined : "all";

    // ---- Auth ----
    const accessToken = getBearerToken(req);

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" } satisfies ErrorResponse, { status: 401 });
    }

    const { supabase, role: verifiedRole } = await getReportRequestContext(accessToken, body.organization_id);
    const role = asRole(verifiedRole);

    // ---- Branding (for print header + logo) ----
    const branding = await getBranding(supabase, body.organization_id);

    // ---- Query ----
    const statusFilter: Array<"active" | "archived"> = include_archived
      ? ["active", "archived"]
      : ["active"];

    let q = supabase
      .from("members")
      .select(
        [
          "id,first_name,last_name,gender,age_group,status,membership_stage",
          "visitor_details!inner(first_visit_at,follow_up_status,follow_up_notes,how_heard)",
        ].join(",")
      )
      .eq("org_id", body.organization_id)
      .eq("membership_stage", "visitor")
      .in("status", statusFilter)
      .gte("visitor_details.first_visit_at", body.start_date)
      .lte("visitor_details.first_visit_at", body.end_date);

    if (joined === "joined") q = q.eq("visitor_details.follow_up_status", "joined");
    if (joined === "not_joined") q = q.neq("visitor_details.follow_up_status", "joined");

    const { data: rawRows, error } = await q.returns<RawRow[]>();

    if (error) {
      return NextResponse.json({ error: error.message } satisfies ErrorResponse, { status: 400 });
    }

    // ---- Normalize ----
    const normalized: FirstTimersDetailRow[] = (rawRows ?? [])
      .map((r) => {
        const vd = Array.isArray(r.visitor_details) ? r.visitor_details[0] : r.visitor_details;

        const first_visit_at = vd?.first_visit_at ?? null;
        if (!first_visit_at) return null;

        const gender = isGender(r.gender) ? r.gender : null;
        const age_group = isAgeGroup(r.age_group) ? r.age_group : null;
        const joinedBool = vd?.follow_up_status === "joined";

        return {
          member_id: r.id,
          first_visit_at,
          name: safeName(r.first_name, r.last_name),
          how_heard: vd?.how_heard ?? null,
          follow_up_notes: vd?.follow_up_notes ?? null,
          joined: joinedBool,
          demographics: demoLabel(gender, age_group),
          gender,
          age_group,
        };
      })
      .filter((x): x is FirstTimersDetailRow => x !== null)
      .sort((a, b) => a.first_visit_at.localeCompare(b.first_visit_at));

    // ---- Counts ----
    const gender_counts: Record<Gender, number> = { male: 0, female: 0 };
    const age_group_counts: Record<AgeGroup, number> = {
      "1-12": 0,
      "13-17": 0,
      "18-35": 0,
      "36+": 0,
    };

    let unknown_gender = 0;
    let unknown_age_group = 0;

    for (const r of normalized) {
      if (r.gender) gender_counts[r.gender] += 1;
      else unknown_gender += 1;

      if (r.age_group) age_group_counts[r.age_group] += 1;
      else unknown_age_group += 1;
    }

    // ---- Summary ----
    const total_visitors = normalized.length;
    const total_joined = normalized.reduce((acc, r) => acc + (r.joined ? 1 : 0), 0);
    const percentage_joined =
      total_visitors === 0 ? 0 : Math.round((total_joined / total_visitors) * 10000) / 100;

    const resp: FirstTimersReport = {
      ok: true,
      mode: "first_timers",
      branding,
      meta: {
        role,
        start: body.start_date,
        end: body.end_date,
        include_archived,
        joined,
      },
      summary: {
        total_visitors,
        total_joined,
        percentage_joined,
      },
      demographics: {
        gender_counts,
        age_group_counts,
        unknown_gender,
        unknown_age_group,
      },
      detailed: {
        rows: normalized,
      },
    };

    return NextResponse.json(resp);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg } satisfies ErrorResponse, { status: reportErrorStatus(e) });
  }
}
