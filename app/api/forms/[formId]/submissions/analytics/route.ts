import { NextResponse } from "next/server";
import { managedFormErrorStatus, requireManagedFormContext } from "@/lib/server/forms/access";
import { buildQuestionAnalytics, buildResponseTimeline } from "@/lib/server/forms/responseAnalytics";
import { fetchCurrentFormFields, fetchFilteredSubmissions, parseSubmissionFilters } from "@/lib/server/forms/submissionData";
import { fetchOrganizationTimezone } from "@/lib/server/forms/timezone";

const QUESTION_PAGE_SIZE = 50;

export async function GET(req: Request, context: { params: Promise<{ formId: string }> }) {
  try {
    const { formId } = await context.params;
    const { form } = await requireManagedFormContext(req, formId);
    const url = new URL(req.url);
    const filters = parseSubmissionFilters(url);
    const [timezone, currentFields] = await Promise.all([
      fetchOrganizationTimezone(form.org_id),
      fetchCurrentFormFields(formId, form.org_id),
    ]);
    const submissions = await fetchFilteredSubmissions(formId, form.org_id, filters, timezone);
    const questions = buildQuestionAnalytics(submissions, currentFields);
    const questionId = url.searchParams.get("question");
    const question = questionId ? questions.find((item) => item.id === questionId) : null;
    const questionPage = Math.max(1, Number.parseInt(url.searchParams.get("question_page") ?? "1", 10) || 1);
    let questionResponses: Array<{ submission_id: string; value: string | string[]; status: string; submitted_at: string }> = [];
    let questionResponseTotal = 0;
    if (question) {
      const matches = submissions.flatMap((submission) => {
        const hasVariant = submission.form_snapshot?.fields?.some(
          (field) => field.key === question.key && field.type === question.type,
        );
        const value = submission.answers[question.key];
        const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(value?.trim());
        return hasVariant && hasValue ? [{
          submission_id: submission.id,
          value,
          status: submission.status,
          submitted_at: submission.submitted_at,
        }] : [];
      });
      questionResponseTotal = matches.length;
      const start = (questionPage - 1) * QUESTION_PAGE_SIZE;
      questionResponses = matches.slice(start, start + QUESTION_PAGE_SIZE);
    }

    return NextResponse.json({
      matching_total: submissions.length,
      counts: {
        new: submissions.filter((row) => row.status === "new").length,
        reviewed: submissions.filter((row) => row.status === "reviewed").length,
        archived: submissions.filter((row) => row.status === "archived").length,
      },
      timeline: buildResponseTimeline(submissions),
      questions,
      question_responses: questionResponses,
      question_response_total: questionResponseTotal,
      question_page: questionPage,
      question_page_size: QUESTION_PAGE_SIZE,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load response analytics.";
    return NextResponse.json({ error: message }, { status: managedFormErrorStatus(message) });
  }
}
