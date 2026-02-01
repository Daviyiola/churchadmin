import type { ScheduleRole, ScheduleStatus } from "./types";

export function cleanStr(v: unknown): string {
  return String(v ?? "").trim();
}

export function isYYYYMM(v: string): boolean {
  return /^\d{4}-\d{2}$/.test(v);
}

export function isYYYYMMDD(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}

export function isRole(v: unknown): v is ScheduleRole {
  return v === "lead" || v === "asst" || v === "member";
}

export function isStatus(v: unknown): v is ScheduleStatus {
  return v === "pending" || v === "approved" || v === "rejected";
}

export function monthFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}
