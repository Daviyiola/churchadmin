// lib/reports/members/types.ts
export type PaymentMethod = "cash" | "cheque" | "online";

export type MemberGivingMode = "summary" | "detailed" | "monthly";

export type Branding = {
  logo_url: string | null;
  header_text: string;
  subheader_text: string;
  generated_at_iso: string;
};

export type ErrorResponse = { error: string };

export type RunMemberGivingBody = {
  organization_id: string;

  member_id?: string;
  member_ids?: string[];
  mode: MemberGivingMode;

  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD

  category_ids?: string[];
  service_ids?: string[];
  payment_methods?: PaymentMethod[];
};

export type MemberGivingSummaryRow = {
  category_id: string;
  category_name: string;
  amount: number; // dollars
};

export type MemberGivingSummaryReport = {
  ok: true;
  mode: "member_giving";
  branding: Branding;
  meta: { role: string; view: "summary" };
  member: { id: string; name: string };
  period: { start: string; end: string };
  summary: {
    rows: MemberGivingSummaryRow[];
    grand_total: number;
  };
};

export type MemberGivingTxRow = {
  date: string; // YYYY-MM-DD
  category_id: string;
  category_name: string;
  payment_method: PaymentMethod;
  amount: number; // dollars
  entry_type: "normal" | "adjustment";
};

export type MemberGivingMonthBlock = {
  label: string; // "January 2026"
  rows: MemberGivingTxRow[];
  subtotal: number;
};

export type MemberGivingDetailedReport = {
  ok: true;
  mode: "member_giving";
  branding: Branding;
  meta: { role: string; view: "detailed" };
  member: { id: string; name: string };
  period: { start: string; end: string };
  detailed: {
    months: MemberGivingMonthBlock[];
    grand_total: number;
  };
};

export type MemberGivingMonthlyMemberRow = {
  member_id: string;
  member_name: string;
  category_amounts: Record<string, number>;
  total: number;
};

export type MemberGivingMonthlyBlock = {
  key: string;
  label: string;
  covered_start: string;
  covered_end: string;
  rows: MemberGivingMonthlyMemberRow[];
  category_totals: Record<string, number>;
  subtotal: number;
};

export type MemberGivingMonthlyReport = {
  ok: true;
  mode: "member_giving";
  branding: Branding;
  meta: { role: string; view: "monthly" };
  members: Array<{ id: string; name: string }>;
  period: { start: string; end: string };
  monthly: {
    categories: Array<{ id: string; name: string }>;
    months: MemberGivingMonthlyBlock[];
    member_totals: MemberGivingMonthlyMemberRow[];
    category_totals: Record<string, number>;
    grand_total: number;
  };
};

export type MemberGivingReport =
  | MemberGivingSummaryReport
  | MemberGivingDetailedReport
  | MemberGivingMonthlyReport;
