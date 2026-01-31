export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser } from "@/lib/serverAuthz";

type ErrorJson = { error: string };

type RecipientStatus = "pending" | "processing" | "success" | "failure" | "skipped";

export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    if (!u.ok) {
      return NextResponse.json<ErrorJson>({ error: u.error }, { status: u.status });
    }

    const url = new URL(req.url);
    const organization_id = String(url.searchParams.get("organization_id") ?? "").trim();
    const job_id = String(url.searchParams.get("job_id") ?? "").trim();

    if (!organization_id) return NextResponse.json({ error: "organization_id required" }, { status: 400 });
    if (!job_id) return NextResponse.json({ error: "job_id required" }, { status: 400 });

    // Must be org member to view progress
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("user_organizations")
      .select("id")
      .eq("organization_id", organization_id)
      .eq("user_id", u.userId)
      .maybeSingle<{ id: string }>();

    if (linkErr) throw new Error(linkErr.message);
    if (!link) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    // Job
    const { data: job, error: jobErr } = await supabaseAdmin
      .from("report_email_jobs")
      .select(
        "id, campaign_id, status, paused_reason, total, sent_success, sent_failure, start_date, end_date, attach_summary, attach_detailed, created_at, updated_at",
      )
      .eq("id", job_id)
      .eq("org_id", organization_id)
      .maybeSingle();

    if (jobErr) throw new Error(jobErr.message);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Recent activity: show the most recently acted-on rows.
    // - sent_at desc puts completed rows on top
    // - idx desc breaks ties and surfaces higher-index rows consistently
    // Note: "processing" rows may have sent_at null; they'll appear later.
    const { data: recent, error: rErr } = await supabaseAdmin
      .from("report_email_job_recipients")
      .select("idx, to_email, display_name, status, error, sent_at")
      .eq("job_id", job_id)
      .order("sent_at", { ascending: false })
      .order("idx", { ascending: false })
      .limit(10);

    if (rErr) throw new Error(rErr.message);

    // Robust done: if there are no rows left in pending/processing, you're done.
    // (More reliable than relying only on counters.)
    const { count: remaining, error: remErr } = await supabaseAdmin
      .from("report_email_job_recipients")
      .select("idx", { count: "exact", head: true })
      .eq("job_id", job_id)
      .in("status", ["pending", "processing"] satisfies RecipientStatus[]);

    if (remErr) throw new Error(remErr.message);

    const done = (remaining ?? 0) === 0;

    return NextResponse.json({
      ok: true,
      job,
      recent: (recent ?? []) as Array<{
        idx: number;
        to_email: string;
        display_name: string | null;
        status: RecipientStatus;
        error: string | null;
        sent_at: string | null;
      }>,
      done,
      remaining: remaining ?? 0, // <-- optional but super useful for UI
    });
  } catch (e) {
    return NextResponse.json<ErrorJson>(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
