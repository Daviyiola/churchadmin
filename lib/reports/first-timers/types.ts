// lib/reports/first-timers/types.ts

export type Role = "owner" | "admin" | "finance" | "member" | "viewer";

export type Gender = "male" | "female";
export type AgeGroup = "1-12" | "13-17" | "18-35" | "36+";

export type ErrorResponse = { error: string };

export type JoinedFilter = "all" | "joined" | "not_joined";

export type Branding = {
  logo_url: string | null;
  header_text: string;
  subheader_text: string;
  generated_at_iso: string;
};

export type RunFirstTimersBody = {
  organization_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string; // YYYY-MM-DD

  include_archived: boolean; // UI default true
  joined: JoinedFilter; // "all" | "joined" | "not_joined"
};

export type FirstTimersDetailRow = {
  member_id: string;
  first_visit_at: string; // YYYY-MM-DD
  name: string;
  how_heard: string | null;
  follow_up_notes: string | null;
  joined: boolean;
  demographics: string; // e.g. "Male · 18-35"
  gender: Gender | null;
  age_group: AgeGroup | null;
};

export type FirstTimersReport = {
  ok: true;
  mode: "first_timers";

  branding: Branding;

  meta: {
    role: Role;
    start: string;
    end: string;
    include_archived: boolean;
    joined: JoinedFilter;
  };

  summary: {
    total_visitors: number;
    total_joined: number;
    percentage_joined: number; // 0-100 (can be 2dp)
  };

  demographics: {
    gender_counts: Record<Gender, number>;
    age_group_counts: Record<AgeGroup, number>;
    unknown_gender: number;
    unknown_age_group: number;
  };

  detailed: {
    rows: FirstTimersDetailRow[];
  };
};
