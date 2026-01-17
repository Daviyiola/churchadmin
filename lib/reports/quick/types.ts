import { getActiveOrgId } from "@/lib/auth";
export type QuickReportMode = "income" | "expense" | "attendance";
export type PaymentMethod = "cash" | "cheque" | "online";
export type Segment = "men" | "women" | "boys" | "girls";

export function buildQuickReportPrintUrl(params: Record<string, string | string[]>) {
  const orgId = getActiveOrgId();
  if (!orgId) throw new Error("No active organization selected.");

  const usp = new URLSearchParams();
  usp.set("org", orgId);

  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach((x) => usp.append(k, x));
    else usp.set(k, v);
  }

  return `/reports/quick/print?${usp.toString()}`;
}

export type RunQuickReportBody = {
  organization_id: string;
  mode: QuickReportMode;
  start_date: string; // yyyy-mm-dd
  end_date: string;   // yyyy-mm-dd

  service_ids?: string[];
  category_ids?: string[];
  payment_methods?: PaymentMethod[];

  vendors?: string[];

  segments?: Segment[];
  age_groups?: string[];
  view?: AttendanceView;
};

// ---------- Response Types ----------
export type IncomeColumn = { id: string; name: string };

export type IncomeRow = {
  member_id: string;
  member_name: string;
  values: Record<string, number>; // categoryId -> dollars
  total: number; // dollars
};

export type IncomeReport = {
  ok: true;
  mode: "income";
  meta: { role: string };
  branding: Branding;
  table: {
    columns: IncomeColumn[];
    rows: IncomeRow[];
    colTotals: Record<string, number>;
    grandTotal: number;
  };
};

export type ExpenseLedgerRow = {
  id: string;
  date: string; // yyyy-mm-dd
  category_id: string;
  category: string;
  description: string;
  vendor: string;
  method: string;
  amount: number; // dollars
  entry_type: "normal" | "adjustment";
};

export type ExpenseTotalsRow = { category: string; amount: number };

export type ExpensePivotTable = {
  columns: { id: string; name: string }[]; // category columns (expense)
  rows: {
    description: string;
    values: Record<string, number>; // category_id -> amount
  }[];
  colTotals: Record<string, number>; // category_id -> total
};

export type ExpenseReport = {
  ok: true;
  mode: "expense";
  meta: { role: string };
  branding: Branding;
  table: ExpensePivotTable;
};

export type AttendanceView = "summary" | "detailed";

export type AttendanceSummaryRow = {
  date: string; // YYYY-MM-DD
  service_id: string;
  service_name: string;
  girls: number;
  boys: number;
  women: number;
  men: number;
  total: number;
};

export type AttendanceDetailedMemberRow = {
  member_id: string;
  member_name: string;
  count: number;
};

export type AttendanceDetailedSegmentBlock = {
  segment: "girls" | "boys" | "women" | "men";
  rows: AttendanceDetailedMemberRow[];
  total: number;
};

export type AttendanceDetailedServiceBlock = {
  service_id: string;
  service_name: string;
  segments: AttendanceDetailedSegmentBlock[];
  grand_total: number;
};

export type AttendanceReport =
  | {
      ok: true;
      mode: "attendance";
      branding: Branding;
      meta: { role: string; view: "summary" };
      summary: { rows: AttendanceSummaryRow[] };
    }
  | {
      ok: true;
      mode: "attendance";
      branding: Branding;
      meta: { role: string; view: "detailed" };
      detailed: { services: AttendanceDetailedServiceBlock[] };
    };


export type QuickReportResponse = IncomeReport | ExpenseReport | AttendanceReport;

export type ErrorResponse = { error: string };

export type Branding = {
  logo_url: string | null;
  header_text: string;
  subheader_text: string;
  banner_bg_rgb: string | null;  
  banner_text_rgb: string | null; 
  generated_at_iso: string;       
};


