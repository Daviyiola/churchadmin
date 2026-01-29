export type QuickReportMode = "income" | "expense" | "attendance";
export type PaymentMethod = "cash" | "cheque" | "online";
export type Segment = "men" | "women" | "boys" | "girls";

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

export type ExpenseSort = "date" | "category";

export type ExpenseLedgerRow = {
  expense_date: string;     // YYYY-MM-DD
  description: string;
  vendor: string;
  category_id: string;
  category_name: string;
  amount: number;           // dollars
};

export type ExpenseReport = {
  ok: true;
  mode: "expense";
  branding: Branding;
  meta: { role: string };
  table: {
    rows: ExpenseLedgerRow[];
    grandTotal: number;
    sort: ExpenseSort;
  };
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


export type RunQuickReportBody = {
  organization_id: string;
  mode: QuickReportMode;
  start_date: string;
  end_date: string;

  service_ids?: string[];
  category_ids?: string[];
  payment_methods?: PaymentMethod[];
  vendors?: string[];

  expense_sort?: ExpenseSort;

  // attendance…
  segments?: Segment[];
  age_groups?: string[];
  view?: AttendanceView;
};