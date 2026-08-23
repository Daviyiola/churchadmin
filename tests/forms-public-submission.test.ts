import { describe, expect, it } from "vitest";
import { parsePublicFormAnswers } from "@/lib/server/forms/publicSubmission";

const key = "7c43773c-d76a-4a47-a816-f4d0888b7f66";

describe("public form answer validation", () => {
  it("trims text and preserves bounded multiple-choice answers", () => {
    expect(parsePublicFormAnswers({ [key]: "  hello  " })).toEqual({ [key]: "hello" });
    expect(parsePublicFormAnswers({ [key]: ["One", "Two", "One"] })).toEqual({
      [key]: ["One", "Two"],
    });
  });

  it("rejects unknown identifiers and unsupported values", () => {
    expect(() => parsePublicFormAnswers({ unsafe: "value" })).toThrow("Invalid form answer");
    expect(() => parsePublicFormAnswers({ [key]: { nested: true } })).toThrow("Invalid form answer");
  });

  it("rejects oversized text and excessive fields", () => {
    expect(() => parsePublicFormAnswers({ [key]: "x".repeat(5001) })).toThrow("too long");
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, index) => [
      `7c43773c-d76a-4a47-a816-${String(index).padStart(12, "0")}`,
      "answer",
    ]));
    expect(() => parsePublicFormAnswers(many)).toThrow("too many answers");
  });
});
