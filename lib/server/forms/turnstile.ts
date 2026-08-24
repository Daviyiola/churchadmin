import { getRequestIp } from "@/lib/server/intake/security";

const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";
const EXPECTED_ACTION = "public_form_submit";

type TurnstileResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

export class TurnstileVerificationError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "TurnstileVerificationError";
  }
}

function allowedHostnames(req: Request) {
  const configured = String(process.env.TURNSTILE_ALLOWED_HOSTNAMES ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (configured.length) return new Set(configured);

  const hosts = new Set<string>();
  try { hosts.add(new URL(req.url).hostname.toLowerCase()); } catch { /* Request URL is validated by Next.js. */ }
  try {
    if (process.env.NEXT_PUBLIC_APP_URL) hosts.add(new URL(process.env.NEXT_PUBLIC_APP_URL).hostname.toLowerCase());
  } catch { /* A malformed optional app URL should not broaden allowed hosts. */ }
  return hosts;
}

export async function verifyPublicFormTurnstile(req: Request, token: unknown, requestId: string) {
  const responseToken = typeof token === "string" ? token.trim() : "";
  if (!responseToken || responseToken.length > 2048) {
    throw new TurnstileVerificationError("Please complete the security check and try again.", 400);
  }

  const secret = process.env.TURNSTILE_SECRET_KEY
    || (process.env.NODE_ENV !== "production" ? TEST_SECRET_KEY : "");
  if (!secret) {
    throw new TurnstileVerificationError("This form's security check is not configured.", 503);
  }

  const body = new URLSearchParams({
    secret,
    response: responseToken,
    remoteip: getRequestIp(req),
    idempotency_key: requestId,
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let verification: TurnstileResponse;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Turnstile returned ${response.status}`);
    verification = await response.json() as TurnstileResponse;
  } catch {
    throw new TurnstileVerificationError("The security check is temporarily unavailable. Please try again.", 503);
  } finally {
    clearTimeout(timeout);
  }

  if (!verification.success) {
    throw new TurnstileVerificationError("Please complete the security check and try again.", 400);
  }

  if (process.env.NODE_ENV === "production") {
    const hostname = String(verification.hostname ?? "").toLowerCase();
    if (!hostname || !allowedHostnames(req).has(hostname) || verification.action !== EXPECTED_ACTION) {
      throw new TurnstileVerificationError("The security check could not be verified. Please try again.", 400);
    }
  }
}
