"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export default function SettingsLegalPage() {
    const router = useRouter();
  const items = [
    {
      title: "Privacy Policy",
      desc: "How Church Admin collects, uses, and stores data.",
      href: "/privacy",
    },
    {
      title: "Terms of Service",
      desc: "Platform usage terms, refunds, arbitration, and liability.",
      href: "/terms",
    },
  ];

  return (
    <>
      <div className="border-b">
       <div className="flex items-center justify-between px-6 py-4">
        <div>
          <div className="text-xl font-semibold">Legal</div>
          <div className="text-sm text-slate-600">
            Platform policies and agreements
          </div></div>

           <button
            className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
            onClick={() => router.push("/app/settings")}
          >
            Back to Settings
          </button>
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-5xl">
          <div className="rounded-3xl border bg-white">
            <div className="divide-y">
              {items.map((it) => (
                <Link
                  key={it.href}
                  href={it.href}
                  className="block px-5 py-4 hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold">{it.title}</div>
                      <div className="mt-1 text-sm text-slate-600">
                        {it.desc}
                      </div>
                    </div>
                    <div className="text-sm text-slate-500">›</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          <div className="mt-4 text-xs text-slate-500">
            By using Church Admin, your organization agrees to these policies.
          </div>
        </div>
      </div>
    </>
  );
}
