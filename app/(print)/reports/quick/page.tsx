import { Suspense } from "react";
import QuickReportsClient from "./QuickReportsClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading…</div>}>
      <QuickReportsClient />
    </Suspense>
  );
}
