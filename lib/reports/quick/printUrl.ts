import { getActiveOrgId } from "@/lib/auth";

export type QuickReportMode = "income" | "expense" | "attendance";
export type PaymentMethod = "cash" | "cheque" | "online";
export type AttendanceView = "summary" | "detailed";
export type ExpenseSort = "date" | "category";

export type QuickReportPrintParams = {
  mode: QuickReportMode;
  start: string; // yyyy-mm-dd
  end: string;   // yyyy-mm-dd

  // URL keys your print page reads via getAll(...)
  service_id?: string[];
  category_id?: string[];
  method?: PaymentMethod[];
  vendor?: string[];

  // attendance
  segment?: ("men" | "women" | "boys" | "girls")[];
  age_group?: string[];
  view?: AttendanceView;

  // expense
  expense_sort?: ExpenseSort;
};

export function buildQuickReportPrintUrl(params: QuickReportPrintParams): string {
  const orgId = getActiveOrgId();
  if (!orgId) throw new Error("No active organization selected.");

  const usp = new URLSearchParams();
  usp.set("org", orgId);

  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => usp.append(k, String(x)));
    else usp.set(k, String(v));
  }

 return `/reports/quick?${usp.toString()}`;

}
