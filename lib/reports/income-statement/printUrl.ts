import { getActiveOrgId } from "@/lib/auth";
import type { RunIncomeStatementBody } from "@/lib/reports/income-statement/types";

function addMany(usp: URLSearchParams, key: string, values?: string[]) {
  if (!values?.length) return;
  for (const v of values) usp.append(key, v);
}

export function buildIncomeStatementPrintUrl(args: Omit<RunIncomeStatementBody, "organization_id">): string {
  const org = getActiveOrgId();
  if (!org) throw new Error("No active organization selected.");

  const usp = new URLSearchParams();
  usp.set("org", org);
  usp.set("start", args.start_date);
  usp.set("end", args.end_date);

  addMany(usp, "service_id", args.service_ids);
  addMany(usp, "income_category_id", args.income_category_ids);
  addMany(usp, "expense_category_id", args.expense_category_ids);

  if (args.payment_methods?.length) {
    for (const m of args.payment_methods) usp.append("method", m);
  }

  return `/reports/income-statement?${usp.toString()}`;
}
