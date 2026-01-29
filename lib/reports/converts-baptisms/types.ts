// lib/reports/converts-baptisms/types.ts

export type Role = "owner" | "admin" | "finance" | "member" | "viewer";

export type Gender = "male" | "female";
export type AgeGroup = "1-12" | "13-17" | "18-35" | "36+";

export type ErrorResponse = { error: string };

export type ReportType = "baptisms" | "new_converts" | "combined";

export type Branding = {
  logo_url: string | null;
  header_text: string;
  subheader_text: string;
  generated_at_iso: string;
};

export type RunConvertsBaptismsBody = {
  organization_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD

  report_type: ReportType;
  include_archived: boolean; // UI default true
};

export type ConertsBaptismsDetailRow = {
  member_id: string;
  name: string;

  demographics: string; // "Male · 18-35"
  gender: Gender | null;
  age_group: AgeGroup | null;

  born_again: boolean | null;
  born_again_date: string | null; // YYYY-MM-DD

  baptized: boolean | null;
  baptism_date: string | null; // YYYY-MM-DD
};

export type ConvertsBaptismsReport = {
  ok: true;
  mode: "converts_baptisms";

  branding: Branding;

  meta: {
    role: Role;
    start: string;
    end: string;
    include_archived: boolean;
    report_type: ReportType;
  };

  summary: {
    total_born_again: number;
    total_baptized: number;
  };

  demographics: {
    gender_counts: Record<Gender, number>;
    age_group_counts: Record<AgeGroup, number>;
    unknown_gender: number;
    unknown_age_group: number;
  };

  detailed: {
    rows: ConertsBaptismsDetailRow[];
  };
};
