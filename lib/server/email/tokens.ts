import crypto from "crypto";
import type { ChurchEmailTopic } from "./types";

type TokenPayload = {
  v: 1;
  c: string;
  p: "manage" | "one_click";
  t?: ChurchEmailTopic;
};

function secret() {
  const value = process.env.EMAIL_PREFERENCE_HMAC_SECRET;
  if (!value || value.length < 32) throw new Error("Email preference signing is not configured.");
  return value;
}

function signature(encoded: string) {
  return crypto.createHmac("sha256", secret()).update(encoded).digest("base64url");
}

export function createEmailPreferenceToken(
  contactId: string,
  purpose: TokenPayload["p"],
  topic?: ChurchEmailTopic,
) {
  const payload: TokenPayload = { v: 1, c: contactId, p: purpose, ...(topic ? { t: topic } : {}) };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${signature(encoded)}`;
}

export function verifyEmailPreferenceToken(token: string, expectedPurpose?: TokenPayload["p"]) {
  const [encoded, supplied] = token.split(".");
  if (!encoded || !supplied) return null;
  const expected = signature(encoded);
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TokenPayload;
    if (payload.v !== 1 || !payload.c || !["manage", "one_click"].includes(payload.p)) return null;
    if (expectedPurpose && payload.p !== expectedPurpose) return null;
    if (payload.p === "one_click" && !payload.t) return null;
    return payload;
  } catch {
    return null;
  }
}

export function hashPreferenceRequest(value: string) {
  return crypto.createHmac("sha256", secret()).update(value).digest("hex");
}
