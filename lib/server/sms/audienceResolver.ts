import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeUsSmsPhone } from "@/lib/sms/phone";
import { estimateSmsSegments, renderSmsPersonalization } from "@/lib/sms/segments";
import { isExplicitAffirmative, type SmsAudienceCriteria, type SmsFormSource } from "@/lib/sms/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_RECIPIENTS = 10000;

type Person = { id: string; first_name: string | null; last_name: string | null; phone: string | null; gender: string | null; age_group: string | null; membership_stage: string | null };
type Recipient = { member_id: string | null; phone_e164: string; display_name: string | null; source_types: string[]; source_labels: string[]; consent_basis: "organization_attestation" | "explicit_form_consent" | "individual_consent"; consent_reference_id: string | null; personalized_character_count: number; personalized_segments: number };

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function ids(value: unknown, max = MAX_RECIPIENTS) {
  return Array.isArray(value) ? [...new Set(value.map(String).filter((item) => UUID.test(item)))].slice(0, max) : [];
}

function strings(value: unknown, allowed: string[]) {
  return Array.isArray(value) ? [...new Set(value.map(String).filter((item) => allowed.includes(item)))] : [];
}

function formSources(value: unknown): SmsFormSource[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 10).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const form_id = String(row.form_id ?? "");
    const phone_field_key = String(row.phone_field_key ?? "");
    const consent_field_key = String(row.consent_field_key ?? "");
    if (![form_id, phone_field_key, consent_field_key].every((item) => UUID.test(item))) return [];
    const affirmative_values = Array.isArray(row.affirmative_values)
      ? row.affirmative_values.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 10)
      : [];
    if (!affirmative_values.length) return [];
    return [{ form_id, phone_field_key, consent_field_key, affirmative_values,
      statuses: strings(row.statuses, ["new", "reviewed", "archived"]) as SmsFormSource["statuses"] }];
  });
}

export function parseSmsAudience(value: unknown): SmsAudienceCriteria {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    include_filtered_people: row.include_filtered_people === true,
    member_ids: ids(row.member_ids),
    genders: strings(row.genders, ["male", "female"]),
    age_groups: strings(row.age_groups, ["1-12", "13-17", "18-35", "36+"]),
    group_ids: ids(row.group_ids),
    department_ids: ids(row.department_ids),
    form_sources: formSources(row.form_sources),
  };
}

function name(person: Person) {
  return `${person.first_name ?? ""} ${person.last_name ?? ""}`.trim() || "Unnamed person";
}

export async function getSmsAudienceOptions(orgId: string) {
  const [people, groups, departments, forms, fields] = await Promise.all([
    fetchAll<Person>((from, to) => supabaseAdmin.from("members").select("id,first_name,last_name,phone,gender,age_group,membership_stage")
      .eq("org_id", orgId).eq("status", "active").order("last_name").order("first_name").range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => supabaseAdmin.from("community_groups").select("id,name").eq("org_id", orgId).eq("status", "active").order("name").range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => supabaseAdmin.from("categories").select("id,name").eq("org_id", orgId).eq("type", "department").eq("status", "active").order("name").range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => supabaseAdmin.from("forms").select("id,title,status").eq("org_id", orgId).order("title").range(from, to)),
    fetchAll<Record<string, unknown>>((from, to) => supabaseAdmin.from("form_fields").select("form_id,field_key,field_type,label,options,position,is_required").eq("org_id", orgId)
      .in("field_type", ["phone", "yes_no", "single_choice", "multiple_choice"]).order("position").range(from, to)),
  ]);
  return {
    people: people.map((person) => ({ id: person.id, name: name(person), phone: person.phone, phone_status: normalizeUsSmsPhone(person.phone), gender: person.gender, age_group: person.age_group, membership_stage: person.membership_stage })),
    groups,
    departments,
    forms: forms.map((form) => ({ ...form, fields: fields.filter((field) => field.form_id === form.id) }))
      .filter((form) => form.fields.some((field) => field.field_type === "phone") && form.fields.some((field) => field.is_required === true && ["yes_no", "single_choice", "multiple_choice"].includes(String(field.field_type)))),
  };
}

export async function resolveSmsAudience(orgId: string, raw: unknown, message: string) {
  if (Array.from(message).length > 1600) throw new Error("SMS messages are limited to 1,600 characters.");
  const criteria = parseSmsAudience(raw);
  const { data: attestation, error: attestationError } = await supabaseAdmin.from("sms_consent_attestations").select("id")
    .eq("org_id", orgId).eq("scope", "church_communications").is("revoked_at", null).maybeSingle<{ id: string }>();
  if (attestationError) throw new Error(attestationError.message);

  const people = await fetchAll<Person>((from, to) => supabaseAdmin.from("members").select("id,first_name,last_name,phone,gender,age_group,membership_stage")
    .eq("org_id", orgId).eq("status", "active").range(from, to));
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const selected = new Map<string, { person: Person; types: Set<string>; labels: Set<string> }>();
  const selectPerson = (person: Person, type: string, label: string) => {
    const current = selected.get(person.id) ?? { person, types: new Set<string>(), labels: new Set<string>() };
    current.types.add(type); current.labels.add(label); selected.set(person.id, current);
  };
  if (criteria.include_filtered_people) for (const person of people) {
    if (criteria.genders.length && !criteria.genders.includes(person.gender ?? "")) continue;
    if (criteria.age_groups.length && !criteria.age_groups.includes(person.age_group ?? "")) continue;
    selectPerson(person, "active_people", "Active people");
  }
  for (const id of criteria.member_ids) { const person = peopleById.get(id); if (person) selectPerson(person, "selected_people", "Selected people"); }

  if (criteria.group_ids.length) {
    const memberships = await fetchAll<{ group_id: string; member_id: string }>((from, to) => supabaseAdmin.from("community_group_members").select("group_id,member_id")
      .eq("org_id", orgId).eq("status", "active").in("group_id", criteria.group_ids).range(from, to));
    for (const row of memberships) { const person = peopleById.get(row.member_id); if (person) selectPerson(person, "community_groups", "Community group"); }
  }
  if (criteria.department_ids.length) {
    const memberships = await fetchAll<{ department_category_id: string; member_id: string }>((from, to) => supabaseAdmin.from("member_departments").select("department_category_id,member_id")
      .eq("org_id", orgId).eq("status", "active").in("department_category_id", criteria.department_ids).range(from, to));
    for (const row of memberships) { const person = peopleById.get(row.member_id); if (person) selectPerson(person, "worker_departments", "Worker department"); }
  }

  const recipientMap = new Map<string, Recipient>();
  let invalid_count = 0, missing_count = 0, suppressed_count = 0, duplicate_count = 0;
  const invalid_reasons: Record<string, number> = {};
  const sourceSets = new Map<string, Set<string>>();
  const formConsentEvidence: Array<Record<string, unknown>> = [];
  const suppressions = await fetchAll<{ phone_e164: string }>((from, to) => supabaseAdmin.from("sms_suppressions").select("phone_e164")
    .eq("org_id", orgId).is("released_at", null).range(from, to));
  const suppressed = new Set(suppressions.map((row) => row.phone_e164));

  const add = (phoneRaw: unknown, recipient: Omit<Recipient, "phone_e164" | "personalized_character_count" | "personalized_segments">, firstName: string) => {
    const normalized = normalizeUsSmsPhone(phoneRaw);
    if (!normalized.ok) {
      if (normalized.reason === "missing") missing_count += 1; else invalid_count += 1;
      invalid_reasons[normalized.reason] = (invalid_reasons[normalized.reason] ?? 0) + 1;
      return;
    }
    if (suppressed.has(normalized.e164)) { suppressed_count += 1; return; }
    const rendered = renderSmsPersonalization(message, firstName);
    const estimate = estimateSmsSegments(rendered);
    const existing = recipientMap.get(normalized.e164);
    if (existing) {
      duplicate_count += 1;
      existing.source_types = [...new Set([...existing.source_types, ...recipient.source_types])];
      existing.source_labels = [...new Set([...existing.source_labels, ...recipient.source_labels])];
      return;
    }
    recipientMap.set(normalized.e164, { ...recipient, phone_e164: normalized.e164, personalized_character_count: estimate.characters, personalized_segments: estimate.segments });
    recipient.source_types.forEach((source) => { const set = sourceSets.get(source) ?? new Set<string>(); set.add(normalized.e164); sourceSets.set(source, set); });
  };

  if (selected.size && !attestation) throw new Error("Complete SMS setup and the organization consent attestation before reviewing directory recipients.");
  for (const item of selected.values()) add(item.person.phone, {
    member_id: item.person.id, display_name: name(item.person), source_types: [...item.types], source_labels: [...item.labels],
    consent_basis: "organization_attestation", consent_reference_id: attestation?.id ?? null,
  }, item.person.first_name ?? "");

  for (const source of criteria.form_sources) {
    const { data: form } = await supabaseAdmin.from("forms").select("id,title").eq("id", source.form_id).eq("org_id", orgId).maybeSingle<{ id: string; title: string }>();
    if (!form) throw new Error("One or more forms are unavailable.");
    const { data: phoneField } = await supabaseAdmin.from("form_fields").select("field_key,field_type,label").eq("org_id", orgId).eq("form_id", form.id).eq("field_key", source.phone_field_key).eq("field_type", "phone").maybeSingle();
    const { data: consentField } = await supabaseAdmin.from("form_fields").select("field_key,field_type,label").eq("org_id", orgId).eq("form_id", form.id).eq("field_key", source.consent_field_key).eq("is_required", true).in("field_type", ["yes_no", "single_choice", "multiple_choice"]).maybeSingle();
    if (!phoneField || !consentField) throw new Error(`Choose a phone field and explicit consent field for ${form.title}.`);
    const statuses = source.statuses.length ? source.statuses : ["new", "reviewed"];
    const submissions = await fetchAll<{ id: string; form_revision: number; submitted_at: string; answers: Record<string, unknown> }>((from, to) => supabaseAdmin.from("form_submissions")
      .select("id,form_revision,submitted_at,answers").eq("org_id", orgId).eq("form_id", form.id).in("status", statuses).range(from, to));
    for (const submission of submissions) {
      const consentAnswer = submission.answers[source.consent_field_key];
      if (!isExplicitAffirmative(consentAnswer, source.affirmative_values)) continue;
      const normalized = normalizeUsSmsPhone(submission.answers[source.phone_field_key]);
      if (normalized.ok) formConsentEvidence.push({
        org_id: orgId, phone_e164: normalized.e164, source_type: "form_submission",
        source_id: submission.id, form_id: form.id, form_submission_id: submission.id,
        form_version: submission.form_revision, consent_field_key: source.consent_field_key,
        consent_field_label: consentField.label, consent_answer: Array.isArray(consentAnswer) ? consentAnswer.join(", ") : String(consentAnswer ?? ""),
        scope: "church_communications", status: "granted", obtained_at: submission.submitted_at,
      });
      add(submission.answers[source.phone_field_key], {
        member_id: null, display_name: null, source_types: ["form_respondents"], source_labels: [form.title],
        consent_basis: "explicit_form_consent", consent_reference_id: submission.id,
      }, "");
    }
  }
  if (formConsentEvidence.length) {
    const submissionIds = formConsentEvidence.map((row) => String(row.form_submission_id));
    const existing = await fetchAll<{ form_submission_id: string; consent_field_key: string }>((from, to) => supabaseAdmin.from("sms_contact_consents")
      .select("form_submission_id,consent_field_key").eq("org_id", orgId).eq("source_type", "form_submission")
      .in("form_submission_id", submissionIds).range(from, to));
    const existingKeys = new Set(existing.map((row) => `${row.form_submission_id}:${row.consent_field_key}`));
    const missing = formConsentEvidence.filter((row) => !existingKeys.has(`${row.form_submission_id}:${row.consent_field_key}`));
    for (let offset = 0; offset < missing.length; offset += 500) {
      const { error } = await supabaseAdmin.from("sms_contact_consents").insert(missing.slice(offset, offset + 500));
      if (error) throw new Error(error.message);
    }
  }
  if (recipientMap.size > MAX_RECIPIENTS) throw new Error(`An SMS campaign can contain at most ${MAX_RECIPIENTS.toLocaleString()} unique recipients.`);
  const recipients = [...recipientMap.values()].sort((a, b) => a.phone_e164.localeCompare(b.phone_e164));
  const base = estimateSmsSegments(message);
  return {
    criteria,
    recipients,
    source_counts: Object.fromEntries([...sourceSets].map(([key, set]) => [key, set.size])),
    eligible_count: recipients.length,
    invalid_count, missing_count, suppressed_count, duplicate_count, invalid_reasons,
    body_hash: createHash("sha256").update(message).digest("hex"),
    character_count: base.characters,
    message_encoding: base.encoding,
    max_segments_per_recipient: recipients.reduce((max, row) => Math.max(max, row.personalized_segments), base.segments),
    estimated_total_segments: recipients.reduce((sum, row) => sum + row.personalized_segments, 0),
  };
}

export async function getSmsReadiness(orgId: string) {
  const people = await fetchAll<{ phone: string | null }>((from, to) => supabaseAdmin.from("members").select("phone").eq("org_id", orgId).eq("status", "active").range(from, to));
  const suppressions = await fetchAll<{ phone_e164: string }>((from, to) => supabaseAdmin.from("sms_suppressions").select("phone_e164").eq("org_id", orgId).is("released_at", null).range(from, to));
  const blocked = new Set(suppressions.map((row) => row.phone_e164));
  const counts = { valid: 0, invalid: 0, missing: 0, suppressed: 0, eligible: 0 };
  for (const person of people) {
    const parsed = normalizeUsSmsPhone(person.phone);
    if (!parsed.ok) { if (parsed.reason === "missing") counts.missing += 1; else counts.invalid += 1; continue; }
    counts.valid += 1;
    if (blocked.has(parsed.e164)) counts.suppressed += 1; else counts.eligible += 1;
  }
  return counts;
}
