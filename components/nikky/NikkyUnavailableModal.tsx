"use client";

import { useRouter } from "next/navigation";

export default function NikkyUnavailableModal() {
  const router = useRouter();

  return (
    <div
      className="absolute inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nikky-unavailable-title"
    >
      <div className="w-full max-w-lg rounded-3xl border bg-white p-6 shadow-2xl sm:p-8">
        <div className="inline-flex rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
          Setup required
        </div>
        <h2
          id="nikky-unavailable-title"
          className="mt-4 text-2xl font-semibold text-slate-900"
        >
          Nikky is not enabled for this organization
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          An organization owner or admin can review the timezone and monthly
          allowance, then enable Nikky for owner, admin, and finance users.
          Normal Church Admin features are still available.
        </p>
        <div className="mt-6 rounded-2xl bg-slate-50 p-4 text-sm text-slate-600">
          If you cannot change these settings yourself, you can still open the
          settings page to see what needs to be configured and contact an
          organization owner or admin.
        </div>
        <button
          type="button"
          onClick={() => router.push("/app/settings/nikky")}
          className="mt-6 w-full rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-primary/85"
        >
          Go to Nikky settings
        </button>
      </div>
    </div>
  );
}
