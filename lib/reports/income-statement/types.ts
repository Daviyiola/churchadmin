export type Role = "owner" | "admin" | "finance" | "member";

export type Branding = {
  logo_url: string | null;
  header_text: string;
  subheader_text: string;
  generated_at_iso: string;
};

export type IncomeStatementLine = {
  category_id: string;
  category_name: string;
  amount: number; // dollars
};

export type RunIncomeStatementBody = {
  organization_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD

  // Optional filters (keep if you want them)
  service_ids?: string[];              // income only
  income_category_ids?: string[];      // income section
  expense_category_ids?: string[];     // expense section
  payment_methods?: ("cash" | "cheque" | "online")[]; // income only
};

export type IncomeStatementReport = {
  ok: true;
  mode: "income_statement";
  branding: Branding;
  meta: { role: Role };

  statement: {
    income: IncomeStatementLine[];
    expenses: IncomeStatementLine[];
    totals: {
      total_income: number;
      total_expense: number;
      net_income: number;
    };
  };
};

export type ErrorResponse = { error: string };