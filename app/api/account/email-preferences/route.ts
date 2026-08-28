import { NextResponse } from "next/server";
import { requireActorId } from "@/lib/server/authUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: Request) {
  try {
    const userId = await requireActorId(request);
    const { data, error } = await supabaseAdmin.from("user_email_preferences")
      .select("product_updates,onboarding_tips,updated_at").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    return NextResponse.json({ product_updates: data?.product_updates ?? true, onboarding_tips: data?.onboarding_tips ?? true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unauthorized" }, { status: 401 });
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireActorId(request);
    const body = await request.json().catch(() => null) as { product_updates?: unknown; onboarding_tips?: unknown } | null;
    if (typeof body?.product_updates !== "boolean" || typeof body?.onboarding_tips !== "boolean") {
      return NextResponse.json({ error: "Both preference values are required." }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("user_email_preferences").upsert({
      user_id: userId,
      product_updates: body.product_updates,
      onboarding_tips: body.onboarding_tips,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unauthorized" }, { status: 401 });
  }
}
