export const SMS_PURPOSES = ["announcement", "reminder", "follow_up", "event", "fundraising", "other"] as const;
export type SmsPurpose = (typeof SMS_PURPOSES)[number];

export type SmsFormSource = {
  form_id: string;
  phone_field_key: string;
  consent_field_key: string;
  affirmative_values: string[];
  statuses: Array<"new" | "reviewed" | "archived">;
};

export type SmsAudienceCriteria = {
  include_filtered_people: boolean;
  member_ids: string[];
  genders: string[];
  age_groups: string[];
  group_ids: string[];
  department_ids: string[];
  form_sources: SmsFormSource[];
};

export const EMPTY_SMS_AUDIENCE: SmsAudienceCriteria = {
  include_filtered_people: false,
  member_ids: [],
  genders: [],
  age_groups: [],
  group_ids: [],
  department_ids: [],
  form_sources: [],
};

export function isExplicitAffirmative(value: unknown, allowed: string[]) {
  const answers = Array.isArray(value) ? value : [value];
  const normalized = new Set(allowed.map((item) => item.trim().toLowerCase()).filter(Boolean));
  return answers.some((item) => normalized.has(String(item ?? "").trim().toLowerCase()));
}
