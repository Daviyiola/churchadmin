import type { NikkyContext } from "@/lib/server/nikky/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    throw new Error(`${field} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is not a valid date.`);
  }
}

export function assertDateRange(startDate: unknown, endDate: unknown) {
  assertIsoDate(startDate, "start_date");
  assertIsoDate(endDate, "end_date");
  if (startDate > endDate) throw new Error("start_date cannot be after end_date.");
  return { startDate, endDate };
}

export function enforceFinanceWindow(
  context: NikkyContext,
  startDate: string,
): void {
  if (context.role === "finance" && startDate < context.financeWindowStart) {
    const error = new Error(
      `The 90-day finance window begins ${context.financeWindowStart}. Choose a start date on or after that date.`,
    );
    error.name = "OutsideFinanceWindowError";
    throw error;
  }
}

export function organizationToday(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function completedMonthRange(today: string, monthsBack: number, length: number) {
  const currentMonth = new Date(`${today.slice(0, 7)}-01T12:00:00.000Z`);
  const endMonth = new Date(currentMonth);
  endMonth.setUTCMonth(endMonth.getUTCMonth() - monthsBack);
  const startMonth = new Date(endMonth);
  startMonth.setUTCMonth(startMonth.getUTCMonth() - length + 1);
  const end = new Date(endMonth);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCDate(0);
  return { start_date: isoDate(startMonth), end_date: isoDate(end) };
}

export function dateContext(context: NikkyContext) {
  const today = organizationToday(context.timezone);
  const date = new Date(`${today}T12:00:00.000Z`);
  const day = date.getUTCDay();
  const daysSincePriorSunday = day === 0 ? 7 : day;
  const lastSundayDate = new Date(date);
  lastSundayDate.setUTCDate(date.getUTCDate() - daysSincePriorSunday);
  const monthStart = `${today.slice(0, 7)}-01`;
  const lastFourSundays = Array.from({ length: 4 }, (_, index) => {
    const sunday = new Date(lastSundayDate);
    sunday.setUTCDate(sunday.getUTCDate() - index * 7);
    return isoDate(sunday);
  }).reverse();
  return {
    timezone: context.timezone,
    today,
    last_sunday: lastSundayDate.toISOString().slice(0, 10),
    last_four_sundays: lastFourSundays,
    this_month: { start_date: monthStart, end_date: today },
    this_year: { start_date: `${today.slice(0, 4)}-01-01`, end_date: today },
    latest_three_completed_months: completedMonthRange(today, 1, 3),
    previous_three_completed_months: completedMonthRange(today, 4, 3),
    finance_window_start:
      context.role === "finance" ? context.financeWindowStart : null,
  };
}
