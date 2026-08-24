import { formatOrganizationTimestamp } from "@/lib/server/forms/timezone";

export type FormAnswer = string | string[];

export type ResponseField = {
  key: string;
  label: string;
  type: string;
};

export type ResponseSubmission = {
  id: string;
  form_revision: number;
  status: "new" | "reviewed" | "archived";
  form_snapshot: { fields?: ResponseField[] };
  answers: Record<string, FormAnswer>;
  submitted_at: string;
  source_type?: string;
  source_label?: string | null;
  person_action?: string | null;
};

export type CurrentFormField = ResponseField & { position: number };

export type QuestionAnalytics = {
  id: string;
  key: string;
  label: string;
  type: string;
  historical: boolean;
  response_count: number;
  blank_count: number;
  unique_count: number;
  options: Array<{ label: string; count: number; percent: number }>;
  number_summary: { total: number; average: number; minimum: number; maximum: number } | null;
};

function present(value: FormAnswer | undefined) {
  return Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
}

function displayValue(value: FormAnswer | undefined) {
  return Array.isArray(value) ? value.join(", ") : value?.trim() ?? "";
}

function variantId(key: string, type: string) {
  return `${key}::${type}`;
}

export function buildQuestionAnalytics(
  submissions: ResponseSubmission[],
  currentFields: CurrentFormField[],
): QuestionAnalytics[] {
  const catalog = new Map<string, { key: string; label: string; type: string; historical: boolean; order: number }>();
  currentFields.forEach((field) => catalog.set(variantId(field.key, field.type), {
    key: field.key,
    label: field.label,
    type: field.type,
    historical: false,
    order: field.position,
  }));

  let historicalOrder = currentFields.length;
  for (const submission of submissions) {
    for (const field of submission.form_snapshot?.fields ?? []) {
      const id = variantId(field.key, field.type);
      if (!catalog.has(id)) {
        catalog.set(id, {
          key: field.key,
          label: field.label,
          type: field.type,
          historical: true,
          order: historicalOrder++,
        });
      }
    }
  }

  return [...catalog.entries()]
    .sort(([, left], [, right]) => Number(left.historical) - Number(right.historical) || left.order - right.order)
    .map(([id, question]) => {
      const values: FormAnswer[] = [];
      let blankCount = 0;
      for (const submission of submissions) {
        const snapshotField = submission.form_snapshot?.fields?.find(
          (field) => field.key === question.key && field.type === question.type,
        );
        if (!snapshotField) continue;
        const value = submission.answers[question.key];
        if (present(value)) values.push(value);
        else blankCount += 1;
      }

      const counts = new Map<string, number>();
      const addCount = (label: string) => counts.set(label, (counts.get(label) ?? 0) + 1);
      if (question.type === "multiple_choice") {
        values.forEach((value) => (Array.isArray(value) ? value : [value]).forEach((item) => addCount(String(item))));
      } else if (question.type === "date") {
        values.forEach((value) => {
          const text = displayValue(value);
          addCount(/^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : text);
        });
      } else if (question.type === "month_day") {
        values.forEach((value) => {
          const text = displayValue(value);
          const month = /^\d{2}-\d{2}$/.test(text) ? text.slice(0, 2) : text;
          const monthNumber = Number(month);
          addCount(monthNumber >= 1 && monthNumber <= 12
            ? new Intl.DateTimeFormat("en", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2020, monthNumber - 1, 1)))
            : month);
        });
      } else if (["single_choice", "dropdown", "yes_no"].includes(question.type)) {
        values.forEach((value) => addCount(displayValue(value)));
      }

      const responseCount = values.length;
      const options = [...counts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 100)
        .map(([label, count]) => ({
          label,
          count,
          percent: responseCount ? Math.round((count / responseCount) * 1000) / 10 : 0,
        }));

      const numbers = question.type === "number"
        ? values.map((value) => Number(displayValue(value))).filter(Number.isFinite)
        : [];
      const total = numbers.reduce((sum, value) => sum + value, 0);

      return {
        id,
        ...question,
        response_count: responseCount,
        blank_count: blankCount,
        unique_count: new Set(values.map(displayValue)).size,
        options,
        number_summary: numbers.length ? {
          total,
          average: total / numbers.length,
          minimum: Math.min(...numbers),
          maximum: Math.max(...numbers),
        } : null,
      };
    });
}

export function buildResponseTimeline(submissions: ResponseSubmission[]) {
  const counts = new Map<string, number>();
  for (const submission of submissions) {
    const day = submission.submitted_at.slice(0, 10);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, count]) => ({ date, count }));
}

export function csvCell(value: unknown) {
  let text = value == null ? "" : Array.isArray(value) ? value.join("; ") : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildResponsesCsv(submissions: ResponseSubmission[], currentFields: CurrentFormField[], timezone = "UTC") {
  const fields = new Map<string, { key: string; label: string; order: number }>();
  currentFields.forEach((field) => fields.set(field.key, { key: field.key, label: field.label, order: field.position }));
  let nextOrder = currentFields.length;
  for (const submission of submissions) {
    for (const field of submission.form_snapshot?.fields ?? []) {
      if (!fields.has(field.key)) fields.set(field.key, { key: field.key, label: field.label, order: nextOrder++ });
    }
  }
  const ordered = [...fields.values()].sort((left, right) => left.order - right.order);
  const header = ["Submission ID", `Submitted at (${timezone})`, "Status", "Form version", "Source", ...ordered.map((field) => field.label)];
  const rows = submissions.map((submission) => [
    submission.id,
    formatOrganizationTimestamp(submission.submitted_at, timezone),
    submission.status,
    submission.form_revision,
    submission.source_label || submission.source_type || "",
    ...ordered.map((field) => submission.answers[field.key] ?? ""),
  ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
