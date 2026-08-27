import { Suspense } from "react";

export default function GetStartedLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="min-h-screen p-10 text-slate-600">Loading setup…</div>}>{children}</Suspense>;
}
