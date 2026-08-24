import { describe, expect, it } from "vitest";
import {
  buildQuestionAnalytics,
  buildResponsesCsv,
  buildResponseTimeline,
  type ResponseSubmission,
} from "@/lib/server/forms/responseAnalytics";
import { localDateStartIso } from "@/lib/server/forms/timezone";

const submissions: ResponseSubmission[] = [
  {
    id: "one",
    form_revision: 2,
    status: "new",
    submitted_at: "2026-08-22T12:00:00.000Z",
    form_snapshot: { fields: [
      { key: "name", label: "Name", type: "short_text" },
      { key: "team", label: "Team", type: "single_choice" },
    ] },
    answers: { name: "=HYPERLINK(\"bad\")", team: "Choir" },
  },
  {
    id: "two",
    form_revision: 1,
    status: "reviewed",
    submitted_at: "2026-08-22T14:00:00.000Z",
    form_snapshot: { fields: [
      { key: "name", label: "Full name", type: "short_text" },
      { key: "legacy", label: "Old question", type: "yes_no" },
      { key: "team", label: "Team", type: "single_choice" },
    ] },
    answers: { name: "Ada", legacy: "Yes", team: "Choir" },
  },
];

describe("form response analytics", () => {
  it("keeps current questions first and preserves historical questions", () => {
    const questions = buildQuestionAnalytics(submissions, [
      { key: "name", label: "Name", type: "short_text", position: 0 },
      { key: "team", label: "Team", type: "single_choice", position: 1 },
    ]);
    expect(questions.map((question) => question.label)).toEqual(["Name", "Team", "Old question"]);
    expect(questions[1].options).toEqual([{ label: "Choir", count: 2, percent: 100 }]);
    expect(questions[2].historical).toBe(true);
  });

  it("buckets the response timeline by day", () => {
    expect(buildResponseTimeline(submissions)).toEqual([{ date: "2026-08-22", count: 2 }]);
  });

  it("exports every question and neutralizes spreadsheet formulas", () => {
    const csv = buildResponsesCsv(submissions, [
      { key: "name", label: "Name", type: "short_text", position: 0 },
      { key: "team", label: "Team", type: "single_choice", position: 1 },
    ]);
    expect(csv).toContain("Old question");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("Choir");
    expect(csv).toContain("Submitted at (UTC)");
    expect(csv).toContain("Aug 22, 2026");
  });

  it("converts organization-local date boundaries to UTC across daylight saving time", () => {
    expect(localDateStartIso("2026-08-23", "America/New_York")).toBe("2026-08-23T04:00:00.000Z");
    expect(localDateStartIso("2026-11-02", "America/New_York")).toBe("2026-11-02T05:00:00.000Z");
  });
});
