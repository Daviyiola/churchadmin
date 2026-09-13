"use client";
import { renderEmailDocument } from "@/lib/email/render";

export default function EmailPreview({ html }: { html: string }) {
  return <iframe title="Email message preview" srcDoc={renderEmailDocument(html)} sandbox=""
    className="h-[520px] w-full rounded-2xl border bg-white" />;
}
