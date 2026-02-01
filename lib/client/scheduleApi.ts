import type {
  AdminEntryPatchBody,
  AdminMonthResponse,
  AdminMonthSettingsPatchBody,
  PublicMetaResponse,
  PublicMonthResponse,
  PublicSubmitBody,
} from "@/lib/schedule/types";

type ApiOk<T> = T;
type ApiErr = { error: string };

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) throw new Error(`HTTP ${res.status}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON (HTTP ${res.status})`);
  }
}

async function apiGet<T>(url: string, jwt?: string): Promise<ApiOk<T>> {
  const res = await fetch(url, {
    method: "GET",
    headers: jwt ? { Authorization: `Bearer ${jwt}` } : undefined,
    cache: "no-store",
  });

  const data = await readJson<T | ApiErr>(res);
  if (!res.ok) {
    const msg = typeof (data as ApiErr).error === "string" ? (data as ApiErr).error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

async function apiSend<T>(url: string, method: "POST" | "PATCH", body: unknown, jwt?: string): Promise<ApiOk<T>> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;

  const res = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const data = await readJson<T | ApiErr>(res);
  if (!res.ok) {
    const msg = typeof (data as ApiErr).error === "string" ? (data as ApiErr).error : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/** ===== Public (token) ===== */

export function getPublicMeta(token: string) {
  return apiGet<PublicMetaResponse>(`/api/schedule/public/meta?token=${encodeURIComponent(token)}`);
}

export function getPublicMonth(token: string, month?: string) {
  const qs = new URLSearchParams({ token });
  if (month) qs.set("month", month);
  return apiGet<PublicMonthResponse>(`/api/schedule/public/month?${qs.toString()}`);
}

export function submitPublic(body: PublicSubmitBody) {
  return apiSend<{ ok: true }>(`/api/schedule/public/submit`, "POST", body);
}

/** ===== Admin (auth) ===== */

export function getAdminMonth(orgId: string, month: string, jwt: string) {
  const qs = new URLSearchParams({ org_id: orgId, month });
  return apiGet<AdminMonthResponse>(`/api/schedule/admin/month?${qs.toString()}`, jwt);
}

export function patchAdminMonthSettings(body: AdminMonthSettingsPatchBody, jwt: string) {
  return apiSend<{ ok: true; month: AdminMonthResponse["month"] }>(
    `/api/schedule/admin/month-settings`,
    "PATCH",
    body,
    jwt,
  );
}

export function patchAdminEntry(body: AdminEntryPatchBody, jwt: string) {
  return apiSend<{ ok: true; entry: AdminMonthResponse["entries"][number] }>(
    `/api/schedule/admin/entry`,
    "PATCH",
    body,
    jwt,
  );
}

export function createAdminEntry(body: {
  org_id: string;
  month: string;
  date: string;
  service_category_id: string | null;
  department_category_id: string | null;
  role: "lead" | "asst" | "member";
  name: string;
  notes: string | null;
  status?: "approved" | "pending" | "rejected";
}, jwt: string) {
  return apiSend<{ ok: true; entry: AdminMonthResponse["entries"][number] }>(
    `/api/schedule/admin/entry`,
    "POST",
    body,
    jwt,
  );
}
