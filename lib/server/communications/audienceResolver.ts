import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  isAudienceEmail,
  normalizeAudienceEmail,
  type AudienceCriteria,
  type AudienceFormSource,
} from "@/lib/communications/audience";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXTRACT_EMAIL_PATTERN = /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;
const MAX_IDS = 10000;
const MAX_FORM_SOURCES = 10;
const MAX_MANUAL_EMAILS = 100;
const MAX_RECIPIENTS = 10000;

type MemberRecord = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  gender: string | null;
  age_group: string | null;
  membership_stage: string | null;
};

type RecipientDraft = {
  email: string;
  display_name: string | null;
  source_types: Set<string>;
  source_labels: Set<string>;
};

export type ResolvedAudience = {
  criteria: AudienceCriteria;
  recipients: Array<{
    email: string;
    display_name: string | null;
    source_types: string[];
    source_labels: string[];
  }>;
  source_counts: Record<string, number>;
  invalid_count: number;
  duplicate_count: number;
};

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanIds(value: unknown, limit = MAX_IDS) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanString).filter((item) => UUID_PATTERN.test(item)))].slice(0, limit);
}

function cleanStrings(value: unknown, allowed: Set<string>) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanString).filter((item) => allowed.has(item)))];
}

function parseFormSources(value: unknown): AudienceFormSource[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_FORM_SOURCES).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const formId = cleanString(row.form_id);
    const fieldKey = cleanString(row.field_key);
    if (!UUID_PATTERN.test(formId) || !UUID_PATTERN.test(fieldKey)) return [];
    const statuses = cleanStrings(row.statuses, new Set(["new", "reviewed", "archived"])) as AudienceFormSource["statuses"];
    return [{ form_id: formId, field_key: fieldKey, statuses: statuses.length ? statuses : ["new", "reviewed"] }];
  });
}

export function parseAudienceCriteria(value: unknown): AudienceCriteria {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const manualText = cleanString(row.manual_text);
  if (manualText.length > 20000) throw new Error("Additional email addresses are too long.");
  return {
    include_filtered_members: row.include_filtered_members === true,
    member_ids: cleanIds(row.member_ids),
    genders: cleanStrings(row.genders, new Set(["male", "female"])),
    age_groups: cleanStrings(row.age_groups, new Set(["1-12", "13-17", "18-35", "36+"])),
    membership_stages: cleanStrings(row.membership_stages, new Set(["member", "visitor"])),
    group_ids: cleanIds(row.group_ids),
    department_ids: cleanIds(row.department_ids),
    form_sources: parseFormSources(row.form_sources),
    manual_text: manualText,
    excluded_emails: Array.isArray(row.excluded_emails)
      ? [...new Set(row.excluded_emails.map(cleanString).filter(isAudienceEmail).map(normalizeAudienceEmail))].slice(0, MAX_RECIPIENTS)
      : [],
  };
}

async function fetchAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

function memberName(member: MemberRecord) {
  return `${member.first_name ?? ""} ${member.last_name ?? ""}`.trim() || null;
}

function extractEmails(value: unknown) {
  if (typeof value !== "string") return [];
  return (value.match(EXTRACT_EMAIL_PATTERN) ?? []).map(normalizeAudienceEmail);
}

export async function getAudienceOptions(orgId: string) {
  const [members, groups, departments, forms, fields] = await Promise.all([
    fetchAll<MemberRecord>((from, to) => supabaseAdmin.from("members")
      .select("id,first_name,last_name,email,gender,age_group,membership_stage")
      .eq("org_id", orgId).eq("status", "active").not("email", "is", null)
      .order("last_name").order("first_name").range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => supabaseAdmin.from("community_groups")
      .select("id,name").eq("org_id", orgId).eq("status", "active").order("name").range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => supabaseAdmin.from("categories")
      .select("id,name").eq("org_id", orgId).eq("type", "department").eq("status", "active").order("name").range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => supabaseAdmin.from("forms")
      .select("id,title,status,is_system").eq("org_id", orgId).order("title").range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => supabaseAdmin.from("form_fields")
      .select("form_id,field_key,field_type,label,position").eq("org_id", orgId)
      .in("field_type", ["email", "short_text", "long_text"])
      .order("position").range(from, to)),
  ]);

  return {
    members: members.filter((member) => member.email && isAudienceEmail(member.email)).map((member) => ({
      id: member.id,
      name: memberName(member) ?? "Unnamed person",
      email: normalizeAudienceEmail(member.email ?? ""),
      gender: member.gender,
      age_group: member.age_group,
      membership_stage: member.membership_stage,
    })),
    groups,
    departments,
    forms: forms.map((form) => ({
      ...form,
      fields: fields.filter((field) => field.form_id === form.id),
    })).filter((form) => form.fields.length > 0),
  };
}

export async function resolveAudience(orgId: string, rawCriteria: unknown): Promise<ResolvedAudience> {
  const criteria = parseAudienceCriteria(rawCriteria);
  const recipientMap = new Map<string, RecipientDraft>();
  const sourceSets = new Map<string, Set<string>>();
  let invalidCount = 0;
  let duplicateCount = 0;

  const add = (emailRaw: string | null | undefined, displayName: string | null, sourceType: string, sourceLabel: string) => {
    const email = normalizeAudienceEmail(emailRaw ?? "");
    if (!isAudienceEmail(email)) {
      invalidCount += 1;
      return;
    }
    sourceSets.set(sourceType, sourceSets.get(sourceType) ?? new Set());
    sourceSets.get(sourceType)?.add(email);
    const existing = recipientMap.get(email);
    if (existing) {
      duplicateCount += 1;
      existing.source_types.add(sourceType);
      existing.source_labels.add(sourceLabel);
      if (!existing.display_name && displayName) existing.display_name = displayName;
      return;
    }
    recipientMap.set(email, {
      email,
      display_name: displayName,
      source_types: new Set([sourceType]),
      source_labels: new Set([sourceLabel]),
    });
  };

  const members = await fetchAll<MemberRecord>((from, to) => supabaseAdmin.from("members")
    .select("id,first_name,last_name,email,gender,age_group,membership_stage")
    .eq("org_id", orgId).eq("status", "active").not("email", "is", null).range(from, to));
  const membersById = new Map(members.map((member) => [member.id, member]));

  if (criteria.include_filtered_members) {
    for (const member of members) {
      if (criteria.genders.length && !criteria.genders.includes(member.gender ?? "")) continue;
      if (criteria.age_groups.length && !criteria.age_groups.includes(member.age_group ?? "")) continue;
      if (criteria.membership_stages.length && !criteria.membership_stages.includes(member.membership_stage ?? "")) continue;
      add(member.email, memberName(member), "members", "Active members");
    }
  }
  for (const memberId of criteria.member_ids) {
    const member = membersById.get(memberId);
    if (member) add(member.email, memberName(member), "individuals", "Selected people");
  }

  if (criteria.group_ids.length) {
    const { data: groups, error: groupError } = await supabaseAdmin.from("community_groups")
      .select("id,name").eq("org_id", orgId).eq("status", "active").in("id", criteria.group_ids);
    if (groupError) throw new Error(groupError.message);
    const groupNames = new Map((groups ?? []).map((group) => [group.id, group.name]));
    if (groupNames.size !== criteria.group_ids.length) throw new Error("One or more community groups are unavailable.");
    const memberships = await fetchAll<{ group_id: string; member_id: string }>((from, to) => supabaseAdmin.from("community_group_members")
      .select("group_id,member_id").eq("org_id", orgId).eq("status", "active").in("group_id", criteria.group_ids).range(from, to));
    for (const membership of memberships) {
      const member = membersById.get(membership.member_id);
      if (member) add(member.email, memberName(member), "community_groups", groupNames.get(membership.group_id) ?? "Community group");
    }
  }

  if (criteria.department_ids.length) {
    const { data: departments, error: departmentError } = await supabaseAdmin.from("categories")
      .select("id,name").eq("org_id", orgId).eq("type", "department").eq("status", "active").in("id", criteria.department_ids);
    if (departmentError) throw new Error(departmentError.message);
    const departmentNames = new Map((departments ?? []).map((department) => [department.id, department.name]));
    if (departmentNames.size !== criteria.department_ids.length) throw new Error("One or more departments are unavailable.");
    const memberships = await fetchAll<{ department_category_id: string; member_id: string }>((from, to) => supabaseAdmin.from("member_departments")
      .select("department_category_id,member_id").eq("org_id", orgId).eq("status", "active")
      .in("department_category_id", criteria.department_ids).range(from, to));
    for (const membership of memberships) {
      const member = membersById.get(membership.member_id);
      if (member) add(member.email, memberName(member), "worker_departments", departmentNames.get(membership.department_category_id) ?? "Worker department");
    }
  }

  for (const source of criteria.form_sources) {
    const { data: form, error: formError } = await supabaseAdmin.from("forms")
      .select("id,title").eq("id", source.form_id).eq("org_id", orgId).maybeSingle<{ id: string; title: string }>();
    if (formError) throw new Error(formError.message);
    if (!form) throw new Error("One or more forms are unavailable.");
    const { data: field, error: fieldError } = await supabaseAdmin.from("form_fields")
      .select("field_key,field_type,label").eq("form_id", source.form_id).eq("org_id", orgId)
      .eq("field_key", source.field_key).in("field_type", ["email", "short_text", "long_text"]).maybeSingle();
    if (fieldError) throw new Error(fieldError.message);
    if (!field) throw new Error(`Choose a valid email, Short Answer, or Paragraph field for ${form.title}.`);
    const submissions = await fetchAll<{ answers: Record<string, unknown> }>((from, to) => supabaseAdmin.from("form_submissions")
      .select("answers").eq("form_id", form.id).eq("org_id", orgId).in("status", source.statuses).range(from, to));
    for (const submission of submissions) {
      const value = submission.answers?.[source.field_key];
      const extracted = extractEmails(value);
      if (typeof value === "string" && value.trim() && extracted.length === 0) invalidCount += 1;
      for (const email of extracted) add(email, null, "form_respondents", `${form.title} · ${String(field.label)}`);
    }
  }

  const manualMatches = extractEmails(criteria.manual_text);
  const manualUnique = [...new Set(manualMatches)];
  if (manualUnique.length > MAX_MANUAL_EMAILS) throw new Error(`Additional email addresses are limited to ${MAX_MANUAL_EMAILS} per broadcast.`);
  const manualTokens = criteria.manual_text.split(/[;,\s]+/).map((value) => value.trim()).filter(Boolean);
  invalidCount += manualTokens.filter((value) => !isAudienceEmail(value)).length;
  for (const email of manualUnique) add(email, null, "additional", "Additional email addresses");

  for (const excluded of criteria.excluded_emails) recipientMap.delete(excluded);
  if (recipientMap.size > MAX_RECIPIENTS) throw new Error(`A broadcast can contain at most ${MAX_RECIPIENTS.toLocaleString()} unique recipients.`);

  return {
    criteria,
    recipients: [...recipientMap.values()].sort((a, b) => a.email.localeCompare(b.email)).map((recipient) => ({
      email: recipient.email,
      display_name: recipient.display_name,
      source_types: [...recipient.source_types].sort(),
      source_labels: [...recipient.source_labels].sort(),
    })),
    source_counts: Object.fromEntries([...sourceSets.entries()].map(([key, emails]) => [key, [...emails].filter((email) => recipientMap.has(email)).length])),
    invalid_count: invalidCount,
    duplicate_count: duplicateCount,
  };
}
