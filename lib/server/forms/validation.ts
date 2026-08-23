export const FORM_FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "phone",
  "number",
  "date",
  "month_day",
  "single_choice",
  "multiple_choice",
  "dropdown",
  "yes_no",
] as const;

export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];
export type FormFieldWidth = "full" | "half";

export type ManagedFormFieldInput = {
  key: string;
  type: FormFieldType;
  label: string;
  help_text: string | null;
  placeholder: string | null;
  required: boolean;
  options: string[];
  width: FormFieldWidth;
  locked: boolean;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireFormText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} is too long.`);
  return text;
}

export function optionalFormText(value: unknown, max: number) {
  const text = String(value ?? "").trim();
  if (text.length > max) throw new Error("A form value is too long.");
  return text || null;
}

export function parseManagedFormFields(value: unknown): ManagedFormFieldInput[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error("A form may contain up to 50 fields.");
  }

  const keys = new Set<string>();
  return value.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error("Invalid form field.");
    }
    const row = candidate as Record<string, unknown>;
    const allowed = new Set([
      "key",
      "type",
      "label",
      "help_text",
      "placeholder",
      "required",
      "options",
      "width",
      "locked",
    ]);
    if (Object.keys(row).some((key) => !allowed.has(key))) {
      throw new Error("Invalid form field properties.");
    }

    const key = String(row.key ?? "").toLowerCase();
    const type = String(row.type ?? "") as FormFieldType;
    const width = String(row.width ?? "full") as FormFieldWidth;
    if (!UUID_PATTERN.test(key) || keys.has(key)) {
      throw new Error("Every form field must have a unique identifier.");
    }
    keys.add(key);
    if (!(FORM_FIELD_TYPES as readonly string[]).includes(type)) {
      throw new Error("Unsupported form field type.");
    }
    if (width !== "full" && width !== "half") {
      throw new Error("Unsupported form field width.");
    }

    const options = Array.isArray(row.options)
      ? row.options.map((option) => String(option).trim()).filter(Boolean)
      : [];
    if (options.length > 50 || options.some((option) => option.length > 120)) {
      throw new Error("A field may contain up to 50 choices.");
    }
    if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) {
      throw new Error("Field choices must be unique.");
    }
    const choiceField = ["single_choice", "multiple_choice", "dropdown"].includes(type);
    if (choiceField && options.length === 0) {
      throw new Error("Choice fields need at least one option.");
    }

    return {
      key,
      type,
      label: requireFormText(row.label, "Field label", 160),
      help_text: optionalFormText(row.help_text, 500),
      placeholder: optionalFormText(row.placeholder, 200),
      required: row.required === true,
      options: choiceField ? options : [],
      width,
      locked: row.locked === true,
    };
  });
}
