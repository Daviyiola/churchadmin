// C:\Users\david\dev\churchadmin\lib\server\authUser.ts

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Server-side anon client just for verifying JWT → user
const supabaseAnon = createClient(url, anonKey, {
  auth: { persistSession: false },
});

export async function requireActorId(req: Request): Promise<string> {
  const authz = req.headers.get("authorization") || "";
  const jwt = authz.startsWith("Bearer ") ? authz.slice(7) : "";

  if (!jwt) throw new Error("UNAUTHORIZED");

  const { data, error } = await supabaseAnon.auth.getUser(jwt);
  if (error || !data.user?.id) throw new Error("UNAUTHORIZED");

  return data.user.id;
}
