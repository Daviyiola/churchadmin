// app/(print)/reports/member-giving/page.tsx
import { Suspense } from "react";
import MemberGivingPrintClient from "./printClient";

export default function MemberGivingPrintPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading…</div>}>
      <MemberGivingPrintClient />
    </Suspense>
  );
}
