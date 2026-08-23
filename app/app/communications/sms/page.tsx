import Link from "next/link";

export default function SmsPage() {
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
    <div className="p-6">
      <div className="max-w-3xl rounded-3xl border bg-white p-6">
        <div className="text-lg font-semibold">SMS is coming soon</div>
        <p className="mt-2 text-sm text-slate-600">
          SMS communications will be available in a later phase.
        </p>
      </div>
    </div>
  </>;
}
