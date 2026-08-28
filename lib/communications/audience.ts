export const AUDIENCE_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;

export type AudienceFormSource = {
  form_id: string;
  field_key: string;
  statuses: Array<"new" | "reviewed" | "archived">;
};

export type AudienceCriteria = {
  include_filtered_members: boolean;
  member_ids: string[];
  genders: string[];
  age_groups: string[];
  membership_stages: string[];
  group_ids: string[];
  department_ids: string[];
  form_sources: AudienceFormSource[];
  manual_text: string;
  excluded_emails: string[];
};

export type AudienceRecipient = {
  id: string;
  email: string;
  display_name: string | null;
  source_types: string[];
  source_labels: string[];
};

export type AudiencePreview = {
  snapshot_id: string;
  expires_at: string;
  total_recipients: number;
  invalid_count: number;
  duplicate_count: number;
  unsubscribed_count: number;
  suppressed_count: number;
  source_counts: Record<string, number>;
  recipients: AudienceRecipient[];
  recipients_truncated: boolean;
};

export function normalizeAudienceEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isAudienceEmail(value: string) {
  const normalized = normalizeAudienceEmail(value);
  return normalized.length <= 254 && AUDIENCE_EMAIL_PATTERN.test(normalized);
}
