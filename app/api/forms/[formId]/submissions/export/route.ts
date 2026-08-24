import { NextResponse } from "next/server";
import { managedFormErrorStatus, requireManagedFormContext } from "@/lib/server/forms/access";
import { buildResponsesCsv } from "@/lib/server/forms/responseAnalytics";
import { fetchCurrentFormFields, fetchFilteredSubmissions, parseSubmissionFilters } from "@/lib/server/forms/submissionData";
import { fetchOrganizationTimezone } from "@/lib/server/forms/timezone";

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "form";
}

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
    const csv = buildResponsesCsv(submissions, currentFields, timezone);
    const filename = `${safeFilename(form.title)}-responses-${new Date().toISOString().slice(0, 10)}.csv`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to export responses.";
    return NextResponse.json({ error: message }, { status: managedFormErrorStatus(message) });
  }
}
