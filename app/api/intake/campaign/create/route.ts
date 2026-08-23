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
    const expiryMode = String(body?.expiry_mode ?? "never").trim();
    const expiresOn =
      expiryMode === "date" ? String(body?.expires_on ?? "").trim() : null;

    if (!orgId) {
      return NextResponse.json({ error: "Missing org_id" }, { status: 400 });
    }
    if (!name) {
      return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
    }
    if (!['never', 'date'].includes(expiryMode)) {
      return NextResponse.json({ error: "Invalid expiration option" }, { status: 400 });
    }
    if (expiryMode === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn ?? "")) {
      return NextResponse.json({ error: "Choose an expiration date" }, { status: 400 });
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

    const { data: inserted, error: insErr } = await supabaseAdmin.rpc(
      "create_intake_campaign_link",
      {
        p_org_id: orgId,
        p_actor_id: actorId,
        p_name: name,
        p_slug: slug,
        p_expiry_mode: expiryMode,
        p_expires_on: expiresOn,
      },
    );

    if (insErr)
      return NextResponse.json({ error: insErr.message }, { status: 400 });

    const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

    const campaign = inserted as {
      id: string;
      slug: string;
      expiry_mode: "never" | "date";
      expires_on: string | null;
      expires_at: string;
    };
    const campaignUrl = `${base}/intake/c/${campaign.slug}`;

    return NextResponse.json({
      ok: true,
      campaign: {
        id: campaign.id,
        slug: campaign.slug,
        expiry_mode: campaign.expiry_mode,
        expires_on: campaign.expires_on,
        expires_at: campaign.expires_at,
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
