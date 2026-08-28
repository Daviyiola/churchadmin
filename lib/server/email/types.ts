export const CHURCH_EMAIL_TOPICS = [
  "broadcast",
  "followup",
  "form_invite",
  "giving_statement",
] as const;

export type ChurchEmailTopic = (typeof CHURCH_EMAIL_TOPICS)[number];
export type EmailKind = "optional" | "essential" | "internal";
export type EmailSkipReason = "unsubscribed" | "suppressed" | "missing_mailing_address";

export type EmailAttachment = {
  filename?: string | false;
  content?: string | Buffer;
  path?: string;
  contentType?: string;
  contentId?: string;
};

export type ManagedEmailInput = {
  kind: EmailKind;
  topic?: ChurchEmailTopic;
  organizationId?: string;
  memberId?: string | null;
  to: string;
  from: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | string[];
  attachments?: EmailAttachment[];
  tags?: Array<{ name: string; value: string }>;
  requireMailingAddress?: boolean;
};

export type ManagedEmailResult =
  | { sent: true; providerId: string | null; contactId: string | null }
  | { sent: false; skipped: true; reason: EmailSkipReason; contactId: string | null }
  | { sent: false; skipped: false; error: string; contactId: string | null };

export type EmailEligibility = {
  eligible: boolean;
  reason: "eligible" | EmailSkipReason;
  contactId: string | null;
  mailingAddress: string | null;
  organizationName: string | null;
};
