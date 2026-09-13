type UploadSelection = { upload_id: string; mode: "inline" | "attachment"; inline_cid?: string };

/** Test and broadcast creation must use the same content and selected files. */
export function emailCampaignContent(input: { organizationId: string; subject: string; html: string; uploads: UploadSelection[] }) {
  return {
    organization_id: input.organizationId,
    subject: input.subject,
    body_html: input.html,
    uploads: input.uploads.map(file => ({
      upload_id: file.upload_id,
      upload_mode: file.mode,
      inline_cid: file.mode === "inline" ? file.inline_cid : undefined,
    })),
  };
}
