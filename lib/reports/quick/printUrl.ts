import { getActiveOrgId } from "@/lib/auth";

export type QuickReportMode = "income" | "expense" | "attendance";

export type QuickReportPrintParams = {
  mode: QuickReportMode;
  start: string; // yyyy-mm-dd
  end: string;   // yyyy-mm-dd

  // ids from categories table
  service_ids?: string[];
  category_ids?: string[];

  payment_methods?: ("cash" | "cheque" | "online")[];

  // expense only
  vendors?: string[];

  // attendance only
  segments?: ("men" | "women" | "boys" | "girls")[];
  age_groups?: string[];
  view?: "summary" | "detailed"; // attendance
};

export function buildQuickReportPrintUrl(params: QuickReportPrintParams): string {
  const orgId = getActiveOrgId();
  if (!orgId) throw new Error("No active organization selected.");

  const usp = new URLSearchParams();
  usp.set("org", orgId);
  usp.set("mode", params.mode);
  usp.set("start", params.start);
  usp.set("end", params.end);

  const addMany = (key: string, values?: string[]) => {
    if (!values || values.length === 0) return;
    values.forEach((v) => usp.append(key, v));
  };

  addMany("service_id", params.service_ids);
  addMany("category_id", params.category_ids);
  addMany("method", params.payment_methods as unknown as string[]);
  addMany("vendor", params.vendors);
  addMany("segment", params.segments as unknown as string[]);
  addMany("age_group", params.age_groups);

  if (params.view) usp.set("view", params.view);

   return `/reports/quick?${usp.toString()}`;
}
