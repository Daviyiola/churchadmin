"use client";

import Link from "next/link";
import { getActiveOrgId } from "@/lib/auth";
import { SmsWorkspace } from "@/components/communications/SmsWorkspace";

export default function SmsPage() {
  const orgId = getActiveOrgId();
  return <>
    <div className="border-b px-6 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-xl font-semibold">SMS</div>
          <p className="text-sm text-slate-600">
            Send text-message campaigns and reminders.
          </p>
        </div>
        <Link href="/app/communications" className="self-start rounded-2xl border bg-white px-4 py-2 text-sm font-semibold hover:bg-slate-50">
          Back to Communications
        </Link>
      </div>
    </div>
    <div className="p-4 sm:p-6">
      <div className="max-w-7xl">
        {orgId ? <SmsWorkspace orgId={orgId} /> : <div className="rounded-3xl border bg-white p-6 text-sm text-red-700">Select an organization to continue.</div>}
      </div>
    </div>
  </>;
}
