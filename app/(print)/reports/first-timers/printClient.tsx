// app/(print)/reports/first-timers/printClient.tsx
"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

import type {
  FirstTimersReport,
  ErrorResponse,
  RunFirstTimersBody,
  JoinedFilter,
  Gender,
  AgeGroup,
  FirstTimersDetailRow,
} from "@/lib/reports/first-timers/types";

type Role = "owner" | "admin" | "finance" | "member" | "viewer";

function isRole(v: unknown): v is Role {
  return (
    v === "owner" ||
    v === "admin" ||
    v === "finance" ||
    v === "member" ||
    v === "viewer"
  );
}

function asRole(v: unknown): Role {
  return isRole(v) ? v : "viewer";
}

/** ---------- URL parsing helpers ---------- */

function isJoinedFilter(v: string): v is JoinedFilter {
  return v === "all" || v === "joined" || v === "not_joined";
}

function parseBool01(v: string | null, defaultValue: boolean) {
  if (v === "1") return true;
  if (v === "0") return false;
  return defaultValue;
}

/** ---------- Minimal runtime validation (no any) ---------- */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isGenderKey(k: string): k is Gender {
  return k === "male" || k === "female";
}

function isAgeGroupKey(k: string): k is AgeGroup {
  return k === "1-12" || k === "13-17" || k === "18-35" || k === "36+";
}

function normalizeGenderCounts(v: unknown): Record<Gender, number> {
  const out: Record<Gender, number> = { male: 0, female: 0 };
  if (!isObject(v)) return out;

  for (const [k, val] of Object.entries(v)) {
    if (isGenderKey(k) && typeof val === "number") out[k] = val;
  }
  return out;
}

function normalizeAgeGroupCounts(v: unknown): Record<AgeGroup, number> {
  const out: Record<AgeGroup, number> = {
    "1-12": 0,
    "13-17": 0,
    "18-35": 0,
    "36+": 0,
  };
  if (!isObject(v)) return out;

  for (const [k, val] of Object.entries(v)) {
    if (isAgeGroupKey(k) && typeof val === "number") out[k] = val;
  }
  return out;
}

function getString(o: Record<string, unknown>, k: string): string | null {
  return typeof o[k] === "string" ? (o[k] as string) : null;
}

function getBool(o: Record<string, unknown>, k: string): boolean | null {
  return typeof o[k] === "boolean" ? (o[k] as boolean) : null;
}

function parseFirstTimersReport(v: unknown): FirstTimersReport | null {
  if (!isObject(v)) return null;
  if (v.ok !== true) return null;
  if (v.mode !== "first_timers") return null;

  // ---- branding (optional in your current API payload) ----
  let branding: FirstTimersReport["branding"] = {
    logo_url: null,
    header_text: "Report",
    subheader_text: "First-timers report",
    generated_at_iso: new Date().toISOString(),
  };

  if (isObject(v.branding)) {
    const b = v.branding;
    const header_text = getString(b, "header_text");
    const subheader_text = getString(b, "subheader_text");
    branding = {
      logo_url: typeof b.logo_url === "string" ? b.logo_url : null,
      header_text: header_text ?? branding.header_text,
      subheader_text: subheader_text ?? branding.subheader_text,
      generated_at_iso:
        typeof b.generated_at_iso === "string"
          ? b.generated_at_iso
          : branding.generated_at_iso,
    };
  }

  // ---- meta (your payload has meta, but shape may differ) ----
  if (!isObject(v.meta)) return null;
  const metaObj = v.meta;

  const role = asRole(metaObj.role);

  // Prefer meta.start/end (new), otherwise period.start/end (old)
  let start = getString(metaObj, "start");
  let end = getString(metaObj, "end");

  if ((!start || !end) && isObject(v.period)) {
    const p = v.period;
    start = start ?? getString(p, "start");
    end = end ?? getString(p, "end");
  }

  if (!start || !end) return null;

  // include_archived/joined might exist in meta (new) OR might be missing (old)
  const include_archived = getBool(metaObj, "include_archived") ?? true;

  const joinedRaw = getString(metaObj, "joined");
  const joined: JoinedFilter =
    joinedRaw && isJoinedFilter(joinedRaw) ? joinedRaw : "all";

  // ---- summary ----
  if (!isObject(v.summary)) return null;
  const s = v.summary;
  if (typeof s.total_visitors !== "number") return null;
  if (typeof s.total_joined !== "number") return null;
  if (typeof s.percentage_joined !== "number") return null;

  // ---- demographics ----
  if (!isObject(v.demographics)) return null;
  const d = v.demographics;

  const gender_counts = normalizeGenderCounts(d.gender_counts);
  const age_group_counts = normalizeAgeGroupCounts(d.age_group_counts);
  const unknown_gender =
    typeof d.unknown_gender === "number" ? d.unknown_gender : 0;
  const unknown_age_group =
    typeof d.unknown_age_group === "number" ? d.unknown_age_group : 0;

  // ---- rows (support BOTH shapes) ----
  // New: v.detailed.rows
  // Old: v.rows
  let rowsUnknown: unknown[] = [];

  if (isObject(v.detailed) && Array.isArray(v.detailed.rows)) {
    rowsUnknown = v.detailed.rows as unknown[];
  } else if (Array.isArray(v.rows)) {
    rowsUnknown = v.rows as unknown[];
  } else {
    // must have rows somewhere
    return null;
  }

  const rows: FirstTimersDetailRow[] = [];
  for (const item of rowsUnknown) {
    if (!isObject(item)) continue;

    if (
      typeof item.member_id !== "string" ||
      typeof item.first_visit_at !== "string" ||
      typeof item.name !== "string" ||
      typeof item.joined !== "boolean" ||
      typeof item.demographics !== "string"
    ) {
      continue;
    }

    rows.push({
      member_id: item.member_id,
      first_visit_at: item.first_visit_at,
      name: item.name,
      how_heard: typeof item.how_heard === "string" ? item.how_heard : null,
      follow_up_notes:
        typeof item.follow_up_notes === "string" ? item.follow_up_notes : null,
      joined: item.joined,
      demographics: item.demographics,
      gender:
        typeof item.gender === "string" &&
        (item.gender === "male" || item.gender === "female")
          ? (item.gender as Gender)
          : null,
      age_group:
        typeof item.age_group === "string" &&
        (item.age_group === "1-12" ||
          item.age_group === "13-17" ||
          item.age_group === "18-35" ||
          item.age_group === "36+")
          ? (item.age_group as AgeGroup)
          : null,
    });
  }

  // ---- produce a normalized FirstTimersReport (new shape) ----
  return {
    ok: true,
    mode: "first_timers",
    branding,
    meta: {
      role,
      start,
      end,
      include_archived,
      joined,
    },
    summary: {
      total_visitors: s.total_visitors,
      total_joined: s.total_joined,
      percentage_joined: s.percentage_joined,
    },
    demographics: {
      gender_counts,
      age_group_counts,
      unknown_gender,
      unknown_age_group,
    },
    detailed: { rows },
  };
}

/** ---------- Page ---------- */

export default function FirstTimersPrintClient() {
  const sp = useSearchParams();
  const qs = sp.toString();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [data, setData] = useState<FirstTimersReport | null>(null);

  const metaFromUrl = useMemo(() => {
    const p = new URLSearchParams(qs);

    const org = p.get("org") ?? "";
    const start = p.get("start") ?? "";
    const end = p.get("end") ?? "";

    const include_archived = parseBool01(p.get("include_archived"), true);

    const joinedParam = p.get("joined");
    const joined: JoinedFilter =
      joinedParam && isJoinedFilter(joinedParam) ? joinedParam : "all";

    return { org, start, end, include_archived, joined };
  }, [qs]);

  const filtersLine = useMemo(() => {
    const parts: string[] = [];
    parts.push(
      metaFromUrl.include_archived ? "Including archived" : "Active only",
    );

    if (metaFromUrl.joined === "joined") parts.push("Joined only");
    if (metaFromUrl.joined === "not_joined") parts.push("Not joined only");

    return parts.join(" • ");
  }, [metaFromUrl]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setErr("");
        setData(null);

        if (!metaFromUrl.org) throw new Error("Missing org in URL.");
        if (!metaFromUrl.start || !metaFromUrl.end)
          throw new Error("Missing start/end dates in URL.");
        if (metaFromUrl.end < metaFromUrl.start)
          throw new Error("End date cannot be earlier than start date.");

        const { data: sessionRes, error: sessionErr } =
          await supabase.auth.getSession();
        if (sessionErr) throw new Error(sessionErr.message);

        const token = sessionRes.session?.access_token;
        if (!token) throw new Error("Not authenticated.");

        const body: RunFirstTimersBody = {
          organization_id: metaFromUrl.org,
          start_date: metaFromUrl.start,
          end_date: metaFromUrl.end,
          include_archived: metaFromUrl.include_archived,
          joined: metaFromUrl.joined,
        };

        const res = await fetch("/api/reports/first-timers/run", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
        });

        const json: unknown = await res.json();

        if (!res.ok) {
          const e = isObject(json) ? (json as ErrorResponse) : null;
          throw new Error(e?.error || "Failed to load report");
        }

        const parsed = parseFirstTimersReport(json);
        if (!parsed) {
          const keys = isObject(json) ? Object.keys(json) : [];
          throw new Error(
            `Invalid first-timers report payload (keys: ${keys.join(", ")})`,
          );
        }

        if (cancelled) return;
        setData(parsed);
      } catch (e: unknown) {
        if (cancelled) return;
        setErr(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (cancelled) return;
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [metaFromUrl]);

  const logoUrl = data?.branding.logo_url ?? null;
  const headerText = data?.branding.header_text ?? "Report";
  const subheaderText = data?.branding.subheader_text ?? "First-timers report";

  // Prefer server meta if present (keeps print consistent even if URL is weird)
  const start = data?.meta.start ?? metaFromUrl.start;
  const end = data?.meta.end ?? metaFromUrl.end;

  return (
    <div className="min-h-screen bg-white">
      {/* Top bar (never printed) */}
      <div className="print-hidden sticky top-0 z-10 border-b bg-white">
        <div className="flex items-center justify-between px-6 py-2">
          <div className="text-sm text-slate-600">Print view</div>
          <button
            onClick={() => window.print()}
            className="rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white"
            type="button"
          >
            Print
          </button>
        </div>
      </div>

      <div className="print-root px-10 py-6 print:px-6 print:py-4">
        {/* Header */}
        <div className="text-center">
          {logoUrl ? (
            <div className="mb-2 flex justify-center">
              <Image
                src={logoUrl}
                alt="Organization logo"
                width={80}
                height={80}
                className="h-20 w-20 object-contain"
                unoptimized
                priority
              />
            </div>
          ) : (
            <div className="mb-2" />
          )}

          <div style={{ fontSize: "22pt", fontWeight: 700 }}>{headerText}</div>
          <div style={{ fontSize: "18pt", fontWeight: 700, marginTop: "6pt" }}>
            {subheaderText}
          </div>

          <div style={{ fontSize: "10pt", fontWeight: 600, marginTop: "10pt" }}>
            Time Period: {start} to {end}
          </div>

          {filtersLine ? (
            <div
              style={{ fontSize: "9pt", marginTop: "4pt", color: "#475569" }}
            >
              {filtersLine}
            </div>
          ) : null}
        </div>

        {/* Content */}
        <div className="mt-6">
          <div className="report-container">
            {loading ? (
              <div style={{ fontSize: "11pt", color: "#475569" }}>
                Loading report…
              </div>
            ) : err ? (
              <div style={{ fontSize: "11pt", color: "#b91c1c" }}>{err}</div>
            ) : data ? (
              <ReportBody data={data} />
            ) : (
              <div style={{ fontSize: "11pt", color: "#475569" }}>No data.</div>
            )}
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          .print-hidden {
            display: none !important;
          }
          .print-root {
            padding: 0 !important;
          }
        }

        .report-container {
          width: 100%;
          max-width: 980px;
        }

        table.report-table {
          border-collapse: collapse;
          width: auto;
          table-layout: fixed;
        }

        .th-cell,
        .td-cell {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .td-wrap {
          white-space: normal;
          overflow: visible;
          text-overflow: clip;
          word-break: break-word;
        }

        .break-avoid {
          break-inside: avoid;
          page-break-inside: avoid;
        }
      `}</style>
    </div>
  );
}

function ReportBody({ data }: { data: FirstTimersReport }) {
  return (
    <div className="grid gap-6">
      <div className="break-avoid">
        <SummaryBlock data={data} />
      </div>
      <div>
        <DetailedTable rows={data.detailed.rows} />
      </div>
    </div>
  );
}

function SummaryBlock({ data }: { data: FirstTimersReport }) {
  const s = data.summary;
  const d = data.demographics;

  return (
    <div style={{ fontSize: "11pt" }}>
      <table className="report-table">
        <colgroup>
          <col style={{ width: "520px" }} />
          <col style={{ width: "180px" }} />
        </colgroup>
        <tbody>
          <tr>
            <td className="border border-black bg-slate-100 px-2 py-1 font-semibold td-cell">
              Total visitors
            </td>
            <td className="border border-black px-2 py-1 text-center font-semibold td-cell">
              {s.total_visitors}
            </td>
          </tr>
          <tr>
            <td className="border border-black bg-slate-100 px-2 py-1 font-semibold td-cell">
              Total joined
            </td>
            <td className="border border-black px-2 py-1 text-center font-semibold td-cell">
              {s.total_joined}
            </td>
          </tr>
          <tr>
            <td className="border border-black bg-slate-100 px-2 py-1 font-semibold td-cell">
              Percentage joined
            </td>
            <td className="border border-black px-2 py-1 text-center font-semibold td-cell">
              {s.percentage_joined}%
            </td>
          </tr>
        </tbody>
      </table>

      {/* demographics quick counts */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <table className="report-table">
          <colgroup>
            <col style={{ width: "260px" }} />
            <col style={{ width: "100px" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
                Gender
              </th>
              <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">
                Count
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-black px-2 py-1 td-cell">Male</td>
              <td className="border border-black px-2 py-1 text-center td-cell">
                {d.gender_counts.male}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 td-cell">Female</td>
              <td className="border border-black px-2 py-1 text-center td-cell">
                {d.gender_counts.female}
              </td>
            </tr>
            <tr>
              <td className="border border-black px-2 py-1 td-cell text-slate-700">
                Unknown
              </td>
              <td className="border border-black px-2 py-1 text-center td-cell text-slate-700">
                {d.unknown_gender}
              </td>
            </tr>
          </tbody>
        </table>

        <table className="report-table">
          <colgroup>
            <col style={{ width: "260px" }} />
            <col style={{ width: "100px" }} />
          </colgroup>
          <thead>
            <tr>
              <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
                Age group
              </th>
              <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">
                Count
              </th>
            </tr>
          </thead>
          <tbody>
            <AgeRow label="1-12" value={d.age_group_counts["1-12"]} />
            <AgeRow label="13-17" value={d.age_group_counts["13-17"]} />
            <AgeRow label="18-35" value={d.age_group_counts["18-35"]} />
            <AgeRow label="36+" value={d.age_group_counts["36+"]} />
            <AgeRow label="Unknown" value={d.unknown_age_group} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgeRow({ label, value }: { label: string; value: number }) {
  return (
    <tr>
      <td className="border border-black px-2 py-1 td-cell">{label}</td>
      <td className="border border-black px-2 py-1 text-center td-cell">
        {value}
      </td>
    </tr>
  );
}

function DetailedTable({ rows }: { rows: FirstTimersDetailRow[] }) {
  // widths tuned for printing without “table stretch blow-up”
  const IDX_W = 60;
  const DATE_W = 120;
  const NAME_W = 220;
  const DEMO_W = 160;
  const HEARD_W = 180;
  const JOINED_W = 90;
  const NOTES_W = 260;

  return (
    <div style={{ fontSize: "10.5pt" }}>
      <table className="report-table">
        <colgroup>
          <col style={{ width: `${IDX_W}px` }} />
          <col style={{ width: `${DATE_W}px` }} />
          <col style={{ width: `${NAME_W}px` }} />
          <col style={{ width: `${DEMO_W}px` }} />
          <col style={{ width: `${HEARD_W}px` }} />
          <col style={{ width: `${JOINED_W}px` }} />
          <col style={{ width: `${NOTES_W}px` }} />
        </colgroup>

        <thead>
          <tr>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              #
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              First visit
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              Name
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              Demographics
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              How heard
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-center font-semibold th-cell">
              Joined
            </th>
            <th className="border border-black bg-slate-100 px-2 py-1 text-left font-semibold th-cell">
              Follow-up notes
            </th>
          </tr>
        </thead>

        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.member_id}-${r.first_visit_at}-${i}`}>
              <td className="border border-black px-2 py-1 td-cell">{i + 1}</td>
              <td className="border border-black px-2 py-1 td-cell">
                {r.first_visit_at}
              </td>
              <td
                className="border border-black px-2 py-1 td-wrap"
                title={r.name}
              >
                {r.name}
              </td>
              <td
                className="border border-black px-2 py-1 td-cell"
                title={r.demographics}
              >
                {r.demographics}
              </td>
              <td
                className="border border-black px-2 py-1 td-wrap"
                title={r.how_heard ?? ""}
              >
                {r.how_heard ?? ""}
              </td>
              <td className="border border-black px-2 py-1 text-center td-cell">
                {r.joined ? "Yes" : "No"}
              </td>
              <td
                className="border border-black px-2 py-1 td-wrap"
                title={r.follow_up_notes ?? ""}
              >
                {r.follow_up_notes ?? ""}
              </td>
            </tr>
          ))}

          {rows.length === 0 ? (
            <tr>
              <td
                className="border border-black px-2 py-3 text-slate-600"
                colSpan={7}
              >
                No visitors in this range.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
