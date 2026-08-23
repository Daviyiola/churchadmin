export type SubmittedField = {
  label: string;
  type: string;
  options?: string[];
};

export type ExistingCustomField = {
  id: string;
  name: string;
  field_type: string;
};

export type MappingSuggestion = {
  target: string;
  label: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

const STANDARD_LABELS: Record<string, string> = {
  first_name: "First name", last_name: "Last name", gender: "Gender",
  age_group: "Age group", email: "Email", phone: "Phone", address: "Address",
  marital_status: "Marital status", children_count: "Number of children",
  joined_at: "Joined date", dob: "Date of birth", notes: "Notes",
  baptized: "Baptized", baptism_date: "Baptism date", born_again: "Born again",
  born_again_date: "Born again date", first_visit_at: "First visit",
  how_heard: "How they heard about us", prayer_requests: "Prayer requests",
};

const LABEL_ALIASES: Record<string, string> = {
  "first name": "first_name", firstname: "first_name", "given name": "first_name",
  "last name": "last_name", lastname: "last_name", surname: "last_name", "family name": "last_name",
  gender: "gender", sex: "gender", "age group": "age_group", agegroup: "age_group",
  email: "email", "email address": "email", phone: "phone", "phone number": "phone",
  "mobile number": "phone", mobile: "phone", telephone: "phone", whatsapp: "phone",
  address: "address", "home address": "address", "mailing address": "address",
  "marital status": "marital_status", "number of children": "children_count", "children count": "children_count",
  "joined date": "joined_at", "date joined": "joined_at", "membership date": "joined_at",
  dob: "dob", birthday: "dob", "date of birth": "dob", notes: "notes", note: "notes",
  baptized: "baptized", baptised: "baptized", "baptism date": "baptism_date", "date baptized": "baptism_date",
  "date baptised": "baptism_date", "born again": "born_again", converted: "born_again",
  "born again date": "born_again_date", "conversion date": "born_again_date",
  "first visit": "first_visit_at", "first visit date": "first_visit_at",
  "how did you hear about us": "how_heard", "how did you hear about the church": "how_heard",
  "how heard": "how_heard", "prayer request": "prayer_requests", "prayer requests": "prayer_requests",
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function textValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join(" ").trim() : value?.trim() ?? "";
}

function standard(key: string, confidence: MappingSuggestion["confidence"], reason: string): MappingSuggestion {
  return { target: `standard:${key}`, label: STANDARD_LABELS[key] ?? key, confidence, reason };
}

function customTypesCompatible(submittedType: string, customType: string) {
  if (submittedType === customType) return true;
  const textTypes = new Set(["short_text", "long_text", "email", "phone"]);
  return textTypes.has(submittedType) && textTypes.has(customType);
}

export function suggestPersonFieldMapping(
  field: SubmittedField,
  answer: string | string[] | undefined,
  customFields: ExistingCustomField[],
): MappingSuggestion {
  const label = normalize(field.label);
  const value = textValue(answer);
  const normalizedValue = normalize(value);

  const exactStandard = LABEL_ALIASES[label];
  if (exactStandard) return standard(exactStandard, "high", "Exact question-name match");

  if (field.type === "email") return standard("email", "high", "Email answer type");
  if (field.type === "phone") return standard("phone", "high", "Phone answer type");
  if (field.type === "month_day" && /birth|birthday|dob/.test(label)) {
    return standard("dob", "high", "Birthday question and month/day answer type");
  }
  if (field.type === "date") {
    if (/birth|birthday|dob/.test(label)) return standard("dob", "high", "Date-of-birth question and date answer type");
    if (/first.*visit|visit.*date/.test(label)) return standard("first_visit_at", "high", "First-visit question and date answer type");
    if (/bapti/.test(label)) return standard("baptism_date", "high", "Baptism question and date answer type");
    if (/born.*again|convert/.test(label)) return standard("born_again_date", "high", "Conversion question and date answer type");
    if (/join|member.*since/.test(label)) return standard("joined_at", "high", "Membership-date question and date answer type");
  }

  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    return standard("email", /email|contact/.test(label) ? "high" : "medium", "The response looks like an email address");
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 7 && /phone|mobile|telephone|whatsapp|contact/.test(label)) {
    return standard("phone", "high", "Phone-like response and contact question");
  }
  if (["male", "female"].includes(normalizedValue)) {
    return standard("gender", /gender|sex/.test(label) ? "high" : "medium", "The response is a supported gender value");
  }
  if (["1 12", "13 17", "18 35", "36"].includes(normalizedValue)) {
    return standard("age_group", /age/.test(label) ? "high" : "medium", "The response is a supported age group");
  }
  if (/children|dependants|dependents/.test(label) && /^\d+$/.test(value)) {
    return standard("children_count", "high", "Children-count question and numeric response");
  }
  if (["yes", "no"].includes(normalizedValue)) {
    if (/bapti/.test(label) && !/date/.test(label)) return standard("baptized", "high", "Baptism question and yes/no response");
    if (/born.*again|convert/.test(label) && !/date/.test(label)) return standard("born_again", "high", "Conversion question and yes/no response");
  }
  if (/prayer/.test(label)) return standard("prayer_requests", "high", "Prayer-request question");
  if (/how.*hear|referred|referral/.test(label)) return standard("how_heard", "high", "Referral-source question");

  const custom = customFields.find((item) => normalize(item.name) === label && customTypesCompatible(field.type, item.field_type));
  if (custom) return { target: `custom:${custom.id}`, label: custom.name, confidence: "high", reason: "Exact existing custom-field match" };

  return { target: "custom:new", label: field.label, confidence: "low", reason: "No reliable standard or existing custom-field match" };
}
