export type PersonMappingValidation = {
  valid: boolean;
  message?: string;
};

type CustomFieldDefinition = {
  id: string;
  name: string;
  field_type: string;
  options?: string[];
};

const LABELS: Record<string, string> = {
  first_name: "First name",
  last_name: "Last name",
  gender: "Gender",
  age_group: "Age group",
  email: "Email",
  phone: "Phone",
  address: "Address",
  marital_status: "Marital status",
  children_count: "Number of children",
  joined_at: "Joined date",
  dob: "Date of birth",
  notes: "Notes",
  baptized: "Baptized",
  baptism_date: "Baptism date",
  born_again: "Born again",
  born_again_date: "Born again date",
  first_visit_at: "First visit",
  how_heard: "How they heard about us",
  prayer_requests: "Prayer requests",
};

const DATE_FIELDS = new Set(["joined_at", "dob", "baptism_date", "born_again_date", "first_visit_at"]);
const SCALAR_FIELDS = new Set(Object.keys(LABELS).filter((key) => key !== "prayer_requests"));

function isBlank(value: unknown) {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function validIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validMonthDay(value: string) {
  const match = /^(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const maxDays = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= maxDays[month - 1];
}

function invalid(label: string): PersonMappingValidation {
  return { valid: false, message: `This answer cannot be converted to ${label}.` };
}

function validateTypedValue(type: string, options: string[] | undefined, value: unknown, label: string) {
  if (isBlank(value)) return { valid: true };
  if (type === "multiple_choice") {
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || (options?.length && !options.includes(item)))) return invalid(label);
    return { valid: true };
  }
  if (Array.isArray(value) || typeof value !== "string") return invalid(label);
  const text = value.trim();
  if (type === "date" && !validIsoDate(text)) return invalid(label);
  if (type === "month_day" && !validMonthDay(text)) return invalid(label);
  if (type === "number" && !/^-?\d+(\.\d+)?$/.test(text)) return invalid(label);
  if (type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return invalid(label);
  if (type === "yes_no" && !["yes", "no"].includes(text.toLowerCase())) return invalid(label);
  if (["single_choice", "dropdown"].includes(type) && options?.length && !options.includes(text)) return invalid(label);
  return { valid: true };
}

export function validatePersonFieldMapping(
  target: string,
  value: unknown,
  customFields: CustomFieldDefinition[],
): PersonMappingValidation {
  if (target === "ignore" || target === "custom:new" || isBlank(value)) return { valid: true };

  if (target.startsWith("custom:")) {
    const custom = customFields.find((field) => field.id === target.slice(7));
    return custom ? validateTypedValue(custom.field_type, custom.options, value, custom.name) : invalid("the selected custom field");
  }

  if (!target.startsWith("standard:")) return invalid("the selected field");
  const key = target.slice(9);
  const label = LABELS[key] ?? "the selected field";
  if (SCALAR_FIELDS.has(key) && (Array.isArray(value) || typeof value !== "string")) return invalid(label);
  const text = textValue(value);

  if (DATE_FIELDS.has(key) && !(validIsoDate(text) || (key === "dob" && validMonthDay(text)))) return invalid(label);
  if (key === "children_count" && (!/^\d+$/.test(text) || Number(text) < 0)) return invalid(label);
  if (["baptized", "born_again"].includes(key) && !["yes", "no", "true", "false", "1", "0"].includes(text.toLowerCase())) return invalid(label);
  if (key === "gender" && !["male", "female"].includes(text.toLowerCase())) return invalid(label);
  if (key === "age_group" && !["1-12", "13-17", "18-35", "36+"].includes(text)) return invalid(label);
  if (key === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return invalid(label);
  return { valid: true };
}
