import { describe, expect, it } from "vitest";
import { suggestPersonFieldMapping } from "@/lib/forms/fieldMappingSuggestions";

describe("form person-field suggestions", () => {
  it("maps exact standard labels with high confidence", () => {
    expect(suggestPersonFieldMapping({ label: "First name", type: "short_text" }, "David", [])).toMatchObject({ target: "standard:first_name", confidence: "high" });
  });
  it("uses answer types and patterns as supporting evidence", () => {
    expect(suggestPersonFieldMapping({ label: "Best contact", type: "short_text" }, "david@example.com", [])).toMatchObject({ target: "standard:email", confidence: "high" });
    expect(suggestPersonFieldMapping({ label: "Your details", type: "short_text" }, "female", [])).toMatchObject({ target: "standard:gender", confidence: "medium" });
  });
  it("prefers a compatible existing custom field over creating another", () => {
    expect(suggestPersonFieldMapping({ label: "Instagram handle", type: "short_text" }, "@church", [{ id: "ig", name: "Instagram handle", field_type: "short_text" }])).toMatchObject({ target: "custom:ig", confidence: "high" });
  });
  it("does not guess a person's identity field from an ambiguous answer", () => {
    expect(suggestPersonFieldMapping({ label: "Emergency contact name", type: "short_text" }, "David", [])).toMatchObject({ target: "custom:new", confidence: "low" });
  });
});
