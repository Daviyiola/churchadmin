import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireUser, requireOrgFinanceOrAbove } from "@/lib/serverAuthz";

export const runtime = "nodejs";

type ErrorJson = { error: string };

function friendlyDeliveryError(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const message = raw.toLowerCase();

  if (message.includes("complaint") || message.includes("email.complained")) {
    return "The recipient reported this message as unwanted.";
  }

  if (message.includes("suppressed") || message.includes("email.suppressed")) {
    return "The email provider blocked delivery to this address.";
  }

  if (
    message.includes("permanent bounce") ||
    message.includes("permanent delivery failure") ||
    message.includes("permanently rejected") ||
    message.includes("email.bounced")
  ) {
    return "The recipient's email provider permanently rejected the message.";
  }

  if (
    message.includes("invalid `from`") ||
    message.includes("invalid from") ||
    message.includes("from field")
  ) {
    return "The sender email address is not configured correctly.";
  }

  if (
    message.includes("domain") &&
    (message.includes("verify") || message.includes("verification"))
  ) {
    return "The sending email domain has not been verified.";
  }

  if (
    message.includes("invalid recipient") ||
    message.includes("invalid `to`") ||
    (message.includes("recipient email") && message.includes("invalid"))
  ) {
    return "The recipient email address is invalid.";
  }

  if (
    message.includes("mailbox") &&
    (message.includes("full") || message.includes("quota"))
  ) {
    return "The recipient's mailbox is full.";
  }

  if (message.includes("attachment")) {
    return "An email attachment could not be processed.";
  }

  if (message.includes("rate limit") || message.includes("too many requests")) {
    return "The email provider temporarily limited sending. Please try again later.";
  }

  return "The email provider could not deliver this message.";
}

function recipientExplanation(
  status: string,
  error: unknown,
  skippedReason?: string | null,
): string | null {
  if (status === "skipped_unsubscribed" || skippedReason === "unsubscribed") {
    return "This address unsubscribed from broadcast emails, so Church Admin did not send the message.";
  }

  if (status === "skipped_suppressed" || skippedReason === "suppressed") {
    return "Delivery to this address is blocked because the email provider or church placed it on a suppression list.";
  }

  if (status === "not_processed") {
    return "This recipient was not processed before the broadcast ended.";
  }

  if (status === "failed") {
    return friendlyDeliveryError(error) ?? "Email provider did not return additional details.";
  }

  return null;
}

export async function GET(req: Request) {
  try {
    const u = await requireUser(req);
    if (!u.ok)
      return NextResponse.json<ErrorJson>({ error: u.error }, { status: u.status });

    const url = new URL(req.url);
    const organization_id = String(url.searchParams.get("organization_id") ?? "").trim();
    const campaign_id = String(url.searchParams.get("campaign_id") ?? "").trim();

    if (!organization_id)
      return NextResponse.json<ErrorJson>({ error: "organization_id required" }, { status: 400 });
    if (!campaign_id)
      return NextResponse.json<ErrorJson>({ error: "campaign_id required" }, { status: 400 });

    const authz = await requireOrgFinanceOrAbove(organization_id, u.userId);
    if (!authz.ok)
      return NextResponse.json<ErrorJson>({ error: authz.error }, { status: authz.status });

    const { data: camp, error: campErr } = await supabaseAdmin
      .from("communication_campaigns")
      .select("id, subject, total_recipients, total_success, total_failure, total_skipped")
      .eq("id", campaign_id)
      .eq("organization_id", organization_id)
      .maybeSingle();

    if (campErr) throw new Error(campErr.message);
    if (!camp)
      return NextResponse.json<ErrorJson>({ error: "Campaign not found" }, { status: 404 });

    const { data: recips, error: rErr } = await supabaseAdmin
      .from("communication_campaign_recipients")
      .select("to_email, success, error, created_at")
      .eq("campaign_id", campaign_id)
      .order("created_at", { ascending: false });

    if (rErr) throw new Error(rErr.message);

    const { data: snapshot, error: snapshotError } = await supabaseAdmin
      .from("communication_audience_snapshots")
      .select("id")
      .eq("campaign_id", campaign_id)
      .maybeSingle();
    if (snapshotError) throw new Error(snapshotError.message);

    let snapshotRecipients: Array<{
      email: string;
      success: boolean | null;
      outcome: string | null;
      error: string | null;
      skipped_reason: string | null;
    }> = [];
    if (snapshot?.id) {
      const { data, error } = await supabaseAdmin
        .from("communication_audience_snapshot_recipients")
        .select("email,success,outcome,error,skipped_reason")
        .eq("snapshot_id", snapshot.id)
        .order("created_at");
      if (error) throw new Error(error.message);
      snapshotRecipients = data ?? [];
    }

    const recipients = snapshotRecipients.length
      ? snapshotRecipients.map((recipient) => {
          const status = recipient.outcome ?? "not_processed";
          return {
            email: recipient.email,
            success: recipient.success === true,
            status,
            explanation: recipientExplanation(
              status,
              recipient.error,
              recipient.skipped_reason,
            ),
          };
        })
      : (recips ?? []).map((recipient) => {
          const status = recipient.success ? "sent" : "failed";
          return {
            email: recipient.to_email,
            success: !!recipient.success,
            status,
            explanation: recipientExplanation(status, recipient.error),
          };
        });
    const unprocessed = Math.max(
      0,
      Number(camp.total_recipients ?? 0) -
        Number(camp.total_success ?? 0) -
        Number(camp.total_failure ?? 0) -
        Number(camp.total_skipped ?? 0),
    );
    return NextResponse.json({
      subject: camp.subject,
      total_recipients: camp.total_recipients ?? 0,
      total_success: camp.total_success ?? 0,
      total_failure: camp.total_failure ?? 0,
      total_skipped: camp.total_skipped ?? 0,
      total_unprocessed: unprocessed,
      recipients,
    });
  } catch (e) {
    return NextResponse.json<ErrorJson>(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400 },
    );
  }
}
