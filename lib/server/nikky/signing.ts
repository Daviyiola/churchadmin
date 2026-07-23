import { createHmac, timingSafeEqual } from "node:crypto";

type ContextSelectionPayload = {
  user_id: string;
  organization_id: string;
  expires_at: number;
};

function signingSecret(): string {
  const value = process.env.NIKKY_CONTEXT_SIGNING_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error("NIKKY_CONTEXT_SIGNING_SECRET must contain at least 32 characters.");
  }
  return value;
}

function signature(value: string): Buffer {
  return createHmac("sha256", signingSecret()).update(value).digest();
}

export function createContextSelectionHandle(
  userId: string,
  organizationId: string,
  ttlSeconds = 300,
): string {
  const payload: ContextSelectionPayload = {
    user_id: userId,
    organization_id: organizationId,
    expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${signature(encoded).toString("base64url")}`;
}

export function verifyContextSelectionHandle(
  handle: string,
  expectedUserId: string,
): ContextSelectionPayload | null {
  const [encoded, suppliedSignature, extra] = handle.split(".");
  if (!encoded || !suppliedSignature || extra) return null;

  const supplied = Buffer.from(suppliedSignature, "base64url");
  const expected = signature(encoded);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as ContextSelectionPayload;
    if (
      payload.user_id !== expectedUserId ||
      typeof payload.organization_id !== "string" ||
      payload.expires_at <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
