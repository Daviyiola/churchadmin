// lib/reports/members/printUrl.ts
import type { MemberGivingMode, PaymentMethod } from "./types";

export type BuildMemberGivingPrintUrlArgs = {
  org: string;
  member_id: string;
  mode: MemberGivingMode;
  start: string;
  end: string;

  category_ids?: string[];
  service_ids?: string[];
  payment_methods?: PaymentMethod[];
};

export function buildMemberGivingPrintUrl(args: BuildMemberGivingPrintUrlArgs) {
  const p = new URLSearchParams();

  p.set("org", args.org);
  p.set("member_id", args.member_id);
  p.set("mode", args.mode);
  p.set("start", args.start);
  p.set("end", args.end);

  for (const id of args.category_ids ?? []) p.append("category_id", id);
  for (const id of args.service_ids ?? []) p.append("service_id", id);
  for (const m of args.payment_methods ?? []) p.append("method", m);

  return `/reports/member-giving?${p.toString()}`;
}
