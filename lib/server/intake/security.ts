import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export class IntakeRateLimitError extends Error {
  constructor() {
    super("Please wait a few minutes before trying again.");
    this.name = "IntakeRateLimitError";
  }
}

function requestFingerprint(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    req.headers.get("cf-connecting-ip")?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    forwarded ||
    "unknown";
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Server intake security is not configured.");
  return crypto.createHmac("sha256", secret).update(ip).digest("hex");
}

export async function enforceIntakeRateLimit(
  req: Request,
  scope: string,
  limit: number,
  windowSeconds: number,
) {
  const { error } = await supabaseAdmin.rpc("consume_intake_rate_limit", {
    p_scope: scope,
    p_fingerprint: requestFingerprint(req),
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (!error) return;
  if (error.message.includes("INTAKE_RATE_LIMITED")) {
    throw new IntakeRateLimitError();
  }
  throw new Error(error.message);
}

export function isHoneypotFilled(body: Record<string, unknown>) {
  return String(body.website ?? "").trim().length > 0;
}

