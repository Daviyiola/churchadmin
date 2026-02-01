// lib/schedule/public_rules.ts
import { monthFromDate, isYYYYMM } from "@/lib/schedule/util";

/** Current month in server time (same as before) */
export function getPublicAllowedMonth(): string {
  return monthFromDate(new Date());
}

function addMonths(yyyyMm: string, delta: number): string {
  // expects "YYYY-MM"
  const [yStr, mStr] = yyyyMm.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  const d = new Date(y, (m - 1) + delta, 1);

  const out = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return out;
}

/** Current month + next two months */
export function getPublicAllowedMonths(): string[] {
  const cur = getPublicAllowedMonth();
  return [cur, addMonths(cur, 1), addMonths(cur, 2)];
}

/** True if requestedMonth is within current + next 2 months */
export function assertPublicMonthAllowed(requestedMonth: string): boolean {
  if (!requestedMonth || !isYYYYMM(requestedMonth)) return false;
  const allowed = getPublicAllowedMonths();
  return allowed.includes(requestedMonth);
}
