// app/api/reports/converts-baptisms/run/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

import type {
  RunConvertsBaptismsBody,
  ConvertsBaptismsReport,
  ErrorResponse,
  Role,
  Branding,
  Gender,
  AgeGroup,
  ReportType,
  ConertsBaptismsDetailRow,
} from "@/lib/reports/converts-baptisms/types";

type OrgRow = { id: string; name: string };

type OrgSettingsRow = {
  organization_id: string;
  logo_path: string | null;
  use_default_logo: boolean;
  report_header_text: string | null;
  report_subheader_text: string | null;
};

type UserOrgRow = { role: string };

type RawRow = {
  id: string;
  first_name: string;
  last_name: string | null;
  gender: Gender | null;
  age_group: AgeGroup | null;
  status: "active" | "archived";

  baptized: boolean | null;
  baptism_date: string | null;

  born_again: boolean | null;
  born_again_date: string | null;
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

function isReportType(v: unknown): v is ReportType {
  return v === "baptisms" || v === "new_converts" || v === "combined";
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

function reportSubheader(rt: ReportType) {
  if (rt === "baptisms") return "Baptisms report";
  if (rt === "new_converts") return "New converts report";
  return "Converts & Baptisms report";
}

async function getBranding(orgId: string, rt: ReportType): Promise<Branding> {
  const { data: org, error: orgErr } = await supabaseAdmin
    .from("organizations")
    .select("id,name")
    .eq("id", orgId)
    .maybeSingle();

  if (orgErr) throw new Error(orgErr.message);

  const { data: s, error: sErr } = await supabaseAdmin
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
    subheader_text: settings?.report_subheader_text ?? reportSubheader(rt),
    generated_at_iso: new Date().toISOString(),
  };
}

function relevantSortKey(rt: ReportType, r: ConertsBaptismsDetailRow): string {
  // Sort ascending by relevant date.
  // Combined: pick the most relevant "in-range" date if possible;
  // fallback to whichever exists; if both exist, use the later one.
  if (rt === "baptisms") return r.baptism_date ?? "";
  if (rt === "new_converts") return r.born_again_date ?? "";

  const ba = r.born_again_date ?? "";
  const bp = r.baptism_date ?? "";

  if (ba && bp) return ba > bp ? ba : bp;
  return ba || bp || "";
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RunConvertsBaptismsBody;

    if (!body.organization_id || !body.start_date || !body.end_date) {
      return NextResponse.json(
        { error: "organization_id, start_date, end_date are required" } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    if (!isYmd(body.start_date) || !isYmd(body.end_date)) {
      return NextResponse.json(
        { error: "start_date and end_date must be YYYY-MM-DD" } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    if (body.end_date < body.start_date) {
      return NextResponse.json(
        { error: "end_date cannot be earlier than start_date" } satisfies ErrorResponse,
        { status: 400 },
      );
    }

    const include_archived =
      typeof body.include_archived === "boolean" ? body.include_archived : true;

    const report_type: ReportType = isReportType(body.report_type)
      ? body.report_type
      : "combined";

    // ---- Auth ----
    const authHeader = req.headers.get("authorization") || "";
    const accessToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!accessToken) {
      return NextResponse.json({ error: "Unauthorized" } satisfies ErrorResponse, { status: 401 });
    }

    const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(accessToken);
    if (userErr || !userRes?.user) {
      return NextResponse.json({ error: "Unauthorized" } satisfies ErrorResponse, { status: 401 });
    }

    const userId = userRes.user.id;

    const { data: membership, error: memErr } = await supabaseAdmin
      .from("user_organizations")
      .select("role")
      .eq("organization_id", body.organization_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (memErr) {
      return NextResponse.json({ error: memErr.message } satisfies ErrorResponse, { status: 400 });
    }
    if (!membership) {
      return NextResponse.json({ error: "Forbidden" } satisfies ErrorResponse, { status: 403 });
    }

    const role = asRole((membership as UserOrgRow).role);

    // ---- Branding ----
    const branding = await getBranding(body.organization_id, report_type);

    // ---- Query ----
    const statusFilter: Array<"active" | "archived"> = include_archived
      ? ["active", "archived"]
      : ["active"];

    let q = supabaseAdmin
      .from("members")
      .select(
        [
          "id,first_name,last_name,gender,age_group,status",
          "baptized,baptism_date,born_again,born_again_date",
        ].join(","),
      )
      .eq("org_id", body.organization_id)
      .in("status", statusFilter);

    if (report_type === "baptisms") {
      q = q
        .eq("baptized", true)
        .gte("baptism_date", body.start_date)
        .lte("baptism_date", body.end_date);
    } else if (report_type === "new_converts") {
      q = q
        .eq("born_again", true)
        .gte("born_again_date", body.start_date)
        .lte("born_again_date", body.end_date);
    } else {
      // Combined: either born-again in range OR baptized in range
      // (still returns one row per member)
      const a = body.start_date;
      const b = body.end_date;
      q = q.or(
        [
          `and(born_again.eq.true,born_again_date.gte.${a},born_again_date.lte.${b})`,
          `and(baptized.eq.true,baptism_date.gte.${a},baptism_date.lte.${b})`,
        ].join(","),
      );
    }

    const { data: rawRows, error } = await q.returns<RawRow[]>();

    if (error) {
      return NextResponse.json({ error: error.message } satisfies ErrorResponse, { status: 400 });
    }

    // ---- Normalize ----
    const rows: ConertsBaptismsDetailRow[] = (rawRows ?? []).map((r) => {
      const gender = isGender(r.gender) ? r.gender : null;
      const age_group = isAgeGroup(r.age_group) ? r.age_group : null;

      return {
        member_id: r.id,
        name: safeName(r.first_name, r.last_name),

        demographics: demoLabel(gender, age_group),
        gender,
        age_group,

        born_again: typeof r.born_again === "boolean" ? r.born_again : null,
        born_again_date: typeof r.born_again_date === "string" ? r.born_again_date : null,

        baptized: typeof r.baptized === "boolean" ? r.baptized : null,
        baptism_date: typeof r.baptism_date === "string" ? r.baptism_date : null,
      };
    });

    // ---- Summary totals (count events in-range) ----
    // IMPORTANT: in combined, a person can contribute to both totals.
    const inRange = (d: string | null) =>
      !!d && d >= body.start_date && d <= body.end_date;

    let total_born_again = 0;
    let total_baptized = 0;

    for (const r of rows) {
      if (r.born_again === true && inRange(r.born_again_date)) total_born_again += 1;
      if (r.baptized === true && inRange(r.baptism_date)) total_baptized += 1;
    }

    // ---- Demographics counts ----
    // Counts are based on included rows (union set for combined)
    const gender_counts: Record<Gender, number> = { male: 0, female: 0 };
    const age_group_counts: Record<AgeGroup, number> = {
      "1-12": 0,
      "13-17": 0,
      "18-35": 0,
      "36+": 0,
    };

    let unknown_gender = 0;
    let unknown_age_group = 0;

    for (const r of rows) {
      if (r.gender) gender_counts[r.gender] += 1;
      else unknown_gender += 1;

      if (r.age_group) age_group_counts[r.age_group] += 1;
      else unknown_age_group += 1;
    }

    // ---- Sort ----
    const sorted = rows
      .slice()
      .sort((a, b) =>
        relevantSortKey(report_type, a).localeCompare(
          relevantSortKey(report_type, b),
        ),
      );

    const resp: ConvertsBaptismsReport = {
      ok: true,
      mode: "converts_baptisms",
      branding,
      meta: {
        role,
        start: body.start_date,
        end: body.end_date,
        include_archived,
        report_type,
      },
      summary: {
        total_born_again,
        total_baptized,
      },
      demographics: {
        gender_counts,
        age_group_counts,
        unknown_gender,
        unknown_age_group,
      },
      detailed: {
        rows: sorted,
      },
    };

    return NextResponse.json(resp);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg } satisfies ErrorResponse, { status: 400 });
  }
}
