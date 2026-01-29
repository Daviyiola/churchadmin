// lib/reports/converts-baptisms/printUrl.ts

import type { ReportType } from "./types";

export type BuildConvertsBaptismsPrintUrlArgs = {
  org: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD

  report_type?: ReportType; // default "combined"
  include_archived?: boolean; // default true
};

export function buildConvertsBaptismsPrintUrl(
  args: BuildConvertsBaptismsPrintUrlArgs,
) {
  const p = new URLSearchParams();

  p.set("org", args.org);
  p.set("start", args.start);
  p.set("end", args.end);

  const report_type: ReportType = args.report_type ?? "combined";
  const includeArchived = args.include_archived ?? true;

  p.set("report_type", report_type);
  p.set("include_archived", includeArchived ? "1" : "0");

  return `/reports/converts-baptisms?${p.toString()}`;
}
