import { Suspense } from "react";
import IncomeStatementPrintClient from "./print-client";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading…</div>}>
      <IncomeStatementPrintClient />
    </Suspense>
  );
}
