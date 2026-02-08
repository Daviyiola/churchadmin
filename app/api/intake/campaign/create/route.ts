import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireActorId } from "@/lib/server/authUser";

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50);
}

function addDaysTS(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function makeSuffix(len = 8) {
  // short unique-ish suffix
  return crypto
    .randomBytes(Math.ceil(len / 2))
    .toString("hex")
    .slice(0, len);
}

export async function POST(req: Request) {
  try {
    const actorId = await requireActorId(req);

    const body = await req.json().catch(() => null);
    const orgId = String(body?.org_id ?? "").trim();
    const name = String(body?.name ?? "Intake QR").trim();
    const expiresInDaysRaw = Number(body?.expires_in_days ?? 30);

    const expiresInDays =
      Number.isFinite(expiresInDaysRaw) &&
      expiresInDaysRaw > 0 &&
      expiresInDaysRaw <= 31
        ? Math.floor(expiresInDaysRaw)
        : 30; // default 30 days, max 70 days

    if (!orgId) {
      return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
    }

    // Permission check: must be linked to org with owner/admin/finance
    const { data: link, error: linkErr } = await supabaseAdmin
      .from("user_organizations")
      .select("role")
      .eq("user_id", actorId)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (linkErr)
      return NextResponse.json({ error: linkErr.message }, { status: 400 });
    if (!link)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const role = String(link.role);
    if (!["owner", "admin", "finance"].includes(role)) {
      return NextResponse.json(
        { error: "Forbidden: insufficient role" },
        { status: 403 },
      );
    }

    // slug: name + short suffix to avoid collisions
    const slugBase = slugify(name) || "intake";
    const slug = `${slugBase}-${makeSuffix(10)}`;

    const expires_at = addDaysTS(expiresInDays);

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("intake_campaigns")
      .insert({
        org_id: orgId,
        name,
        slug,
        expires_at,
        is_active: true,
        created_by: actorId,
      })
      .select("id, slug, expires_at")
      .single();

    if (insErr)
      return NextResponse.json({ error: insErr.message }, { status: 400 });

    const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

    const campaignUrl = `${base}/intake/c/${inserted.slug}`;

    return NextResponse.json({
      ok: true,
      campaign: {
        id: inserted.id,
        slug: inserted.slug,
        expires_at: inserted.expires_at,
      },
      campaignUrl,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
