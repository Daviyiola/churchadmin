// app/(print)/reports/converts-baptisms/page.tsx
import { Suspense } from "react";
import ConvertsBaptismsPrintClient from "./printClient";

export default function ConvertsBaptismsPrintPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-600">Loading…</div>}>
      <ConvertsBaptismsPrintClient />
    </Suspense>
  );
}
