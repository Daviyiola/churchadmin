// app/(print)/reports/first-timers/page.tsx
import { Suspense } from "react";
import FirstTimersPrintClient from "./printClient";

export default function FirstTimersPrintPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading…</div>}>
      <FirstTimersPrintClient />
    </Suspense>
  );
}
