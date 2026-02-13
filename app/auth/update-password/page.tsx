// app/auth/update-password/page.tsx
"use client";

import { Suspense } from "react";
import UpdatePasswordInner from "./update-password-inner";

export default function UpdatePasswordPage() {
  return (
    <Suspense fallback={<UpdatePasswordSkeleton />}>
      <UpdatePasswordInner />
    </Suspense>
  );
}

function UpdatePasswordSkeleton() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <section className="mx-auto max-w-md px-6 pt-14">
        <div className="rounded-3xl border p-6">
          <div className="h-7 w-48 rounded bg-slate-100" />
          <div className="mt-3 h-4 w-72 rounded bg-slate-100" />
          <div className="mt-8 h-11 w-full rounded-2xl bg-slate-100" />
          <div className="mt-4 h-11 w-full rounded-2xl bg-slate-100" />
          <div className="mt-6 h-11 w-full rounded-2xl bg-slate-100" />
        </div>
      </section>
    </main>
  );
}
