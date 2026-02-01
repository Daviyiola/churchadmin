import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveOrgByToken } from "@/lib/schedule/public";
import { cleanStr } from "@/lib/schedule/util";

type ErrorJson = { error: string };

type CategoryMini = { id: string; name: string };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = cleanStr(searchParams.get("token"));

  if (!token) {
    return NextResponse.json<ErrorJson>({ error: "Missing token" }, { status: 400 });
  }

  const resolved = await resolveOrgByToken(token);
  if (!resolved.ok) {
    return NextResponse.json<ErrorJson>({ error: resolved.error }, { status: resolved.status });
  }

  const { data, error } = await supabaseAdmin
    .from("categories")
    .select("id,name,type,status")
    .eq("org_id", resolved.org_id)
    .eq("status", "active")
    .in("type", ["services", "department"])
    .order("name", { ascending: true });

  if (error) return NextResponse.json<ErrorJson>({ error: error.message }, { status: 400 });

  const services: CategoryMini[] = [];
  const departments: CategoryMini[] = [];

  for (const r of data ?? []) {
    const item = { id: String(r.id), name: String(r.name) };
    if (r.type === "services") services.push(item);
    if (r.type === "department") departments.push(item);
  }

  return NextResponse.json({
    ok: true,
    services,
    departments,
  });
}
