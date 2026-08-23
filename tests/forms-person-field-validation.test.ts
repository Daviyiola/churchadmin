import { describe, expect, it } from "vitest";
import { validatePersonFieldMapping } from "@/lib/forms/personFieldValidation";

describe("person field mapping validation", () => {
  it("rejects a name mapped to a date", () => {
    expect(validatePersonFieldMapping("standard:dob", "David Iyiola", [])).toEqual({
      valid: false,
      message: "This answer cannot be converted to Date of birth.",
    });
  });

  it("accepts a real ISO date from a short answer", () => {
    expect(validatePersonFieldMapping("standard:dob", "1990-04-12", [])).toEqual({ valid: true });
  });

  it("accepts a month/day birthday but keeps other dates year-specific", () => {
    expect(validatePersonFieldMapping("standard:dob", "04-12", [])).toEqual({ valid: true });
    expect(validatePersonFieldMapping("standard:dob", "02-30", []).valid).toBe(false);
    expect(validatePersonFieldMapping("standard:joined_at", "04-12", []).valid).toBe(false);
  });

  it("rejects impossible calendar dates", () => {
    expect(validatePersonFieldMapping("standard:first_visit_at", "2026-02-31", []).valid).toBe(false);
  });

  it("validates enums and numeric person fields", () => {
    expect(validatePersonFieldMapping("standard:gender", "female", []).valid).toBe(true);
    expect(validatePersonFieldMapping("standard:gender", "unknown", []).valid).toBe(false);
    expect(validatePersonFieldMapping("standard:children_count", "3", []).valid).toBe(true);
    expect(validatePersonFieldMapping("standard:children_count", "three", []).valid).toBe(false);
  });

  it("uses an existing custom field's type", () => {
    const fields = [{ id: "birthday", name: "Birthday", field_type: "date", options: [] }];
    expect(validatePersonFieldMapping("custom:birthday", "August someday", fields).valid).toBe(false);
    expect(validatePersonFieldMapping("custom:birthday", "2001-08-08", fields).valid).toBe(true);
  });

  it("allows blanks so required-field handling can explain what is missing", () => {
    expect(validatePersonFieldMapping("standard:first_name", "", []).valid).toBe(true);
  });
});
