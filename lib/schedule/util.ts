import type { ScheduleRole, ScheduleStatus } from "./types";

export function cleanStr(v: unknown): string {
  return String(v ?? "").trim();
}

export function isYYYYMM(v: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

export function isYYYYMMDD(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const date = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
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
