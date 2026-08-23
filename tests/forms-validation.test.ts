import { describe, expect, it } from "vitest";
import {
  optionalFormText,
  parseManagedFormFields,
  requireFormText,
} from "@/lib/server/forms/validation";

const field = {
  key: "6c08ab54-a659-4d98-8686-6be3973840cc",
  type: "short_text",
  label: "Full name",
  help_text: null,
  placeholder: null,
  required: true,
  options: [],
  width: "full",
  locked: false,
};

describe("managed form validation", () => {
  it("normalizes a valid field", () => {
    expect(parseManagedFormFields([field])).toEqual([field]);
  });

  it("requires choices for choice fields", () => {
    expect(() => parseManagedFormFields([{ ...field, type: "dropdown" }]))
      .toThrow("Choice fields need at least one option");
  });

  it("accepts responsive half-width fields", () => {
    expect(parseManagedFormFields([{ ...field, width: "half" }])[0].width)
      .toBe("half");
    expect(() => parseManagedFormFields([{ ...field, width: "third" }]))
      .toThrow("Unsupported form field width");
  });

  it("preserves the built-in field lock marker", () => {
    expect(parseManagedFormFields([{ ...field, locked: true }])[0].locked)
      .toBe(true);
  });

  it("rejects duplicate choices case-insensitively", () => {
    expect(() => parseManagedFormFields([{
      ...field,
      type: "single_choice",
      options: ["Sunday", "sunday"],
    }])).toThrow("Field choices must be unique");
  });

  it("rejects unknown properties and oversized forms", () => {
    expect(() => parseManagedFormFields([{ ...field, organization_id: "bad" }]))
      .toThrow("Invalid form field properties");
    expect(() => parseManagedFormFields(Array.from({ length: 51 }, () => field)))
      .toThrow("up to 50 fields");
  });

  it("normalizes form text", () => {
    expect(requireFormText("  Registration  ", "Form name", 120))
      .toBe("Registration");
    expect(optionalFormText("   ", 2000)).toBeNull();
  });
});
