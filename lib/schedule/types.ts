export type ScheduleRole = "lead" | "asst" | "member";
export type ScheduleStatus = "pending" | "approved" | "rejected";

export type OrgBranding = {
  id: string;
  name: string;
  settings: {
    logo_path: string | null;
    use_default_logo: boolean;
    logo_url: string | null;
  };
};

export type PublicMetaResponse = {
  ok: true;
  org: OrgBranding;
  token: { is_active: boolean };
  months: Array<{
    month: string;
    draft_open: boolean;
    is_public_visible: boolean;
  }>;
  defaultMonth: string; // YYYY-MM
    services?: { id: string; name: string }[];
  departments?: { id: string; name: string }[];
};

export type PublicMonthResponse = {
  ok: true;
  month: {
    month: string;
    draft_open: boolean;
    is_public_visible: boolean;
    edits_open: boolean;
  };
  // Approved entries for rendering calendar/modals
  approved: Array<{
    id: string;
    date: string; // YYYY-MM-DD
    service_category_id: string | null;
    department_category_id: string | null;
    role: ScheduleRole;
    name: string;
    notes: string | null;
  }>;
  // Pending counts per date ("Pending (3)")
  pending_counts: Array<{ date: string; count: number }>;
};

export type PublicSubmitBody = {
  token: string;
  month: string; // YYYY-MM
  date: string; // YYYY-MM-DD
  service_category_id: string | null;
  department_category_id: string | null;
  role: ScheduleRole;
  name: string;
  notes: string | null;
  month_code?: string | null;
};

export type AdminMonthResponse = {
  ok: true;
  month: {
    id: string;
    month: string;
    draft_open: boolean;
    edits_open: boolean;
    is_public_visible: boolean;
    month_code_set_at: string | null;
  };

  entries: Array<{
    id: string;
    date: string;
    service_category_id: string | null;
    department_category_id: string | null;
    role: ScheduleRole;
    name: string;
    notes: string | null;
    status: ScheduleStatus;
    created_at: string;
  }>;
  settings: {
    show_birthdays: boolean;
  };
  birthdays: Array<{
    member_id: string;
    date: string;
    name: string;
  }>;
};

export type AdminEntryPatchBody = {
  org_id: string;
  entry_id: string;
  status?: ScheduleStatus;
  name?: string;
  notes?: string | null;
  role?: ScheduleRole;
  service_category_id?: string | null;
  department_category_id?: string | null;
  edits_open?: boolean;
  date?: string; // YYYY-MM-DD
};

export type AdminMonthSettingsPatchBody = {
  org_id: string;
  month: string;
  draft_open?: boolean;
  edits_open?: boolean;
  is_public_visible?: boolean;
};

export type PublicDayEntry = {
  id: string;
  date: string;
  service_category_id: string | null;
  department_category_id: string | null;
  role: ScheduleRole;
  name: string;
  notes: string | null;
  created_at: string; // you return this in the route
};

export type PublicDayResponse = {
  ok: true;
  month: {
    month: string;
    draft_open: boolean;
    edits_open: boolean;
    is_public_visible: boolean;
  };
  approved: PublicDayEntry[];
  pending: PublicDayEntry[];
  rejected: PublicDayEntry[];
};
