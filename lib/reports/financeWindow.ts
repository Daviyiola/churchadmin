export const FINANCE_REPORT_WINDOW_DAYS = 90;

export function financeWindowStart(today = new Date()): string {
  const cutoff = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  cutoff.setUTCDate(cutoff.getUTCDate() - FINANCE_REPORT_WINDOW_DAYS);
  return cutoff.toISOString().slice(0, 10);
}
