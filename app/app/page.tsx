"use client";

import { useState } from "react";

function CoolModal({
  open,
  title,
  onClose,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-lg font-semibold">{title}</div>
            <div className="mt-1 text-sm text-slate-600">Cool, this works! ✅</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-2xl border px-3 py-1 text-sm hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
          This is a UI-only demo modal. Next step: connect to Supabase.
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Nice
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AppDemo() {
  const [modalTitle, setModalTitle] = useState<string>("");
  const [open, setOpen] = useState(false);

  const openModal = (title: string) => {
    setModalTitle(title);
    setOpen(true);
  };

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-72 border-r bg-slate-50">
          <div className="p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-slate-900" />
              <div>
                <div className="text-sm font-semibold leading-tight">churchadmin</div>
                <div className="text-xs text-slate-600">Grace Chapel (Demo)</div>
              </div>
            </div>
          </div>

          <nav className="px-3 pb-6 space-y-1">
            {["Dashboard", "Income", "Expense", "Attendance", "Members", "Categories", "Reports", "Settings"].map(
              (item) => (
                <button
                  key={item}
                  className={`w-full rounded-2xl px-3 py-2 text-left text-sm hover:bg-white ${
                    item === "Income" ? "bg-white border" : ""
                  }`}
                  onClick={() => openModal(`${item} page`)}
                >
                  {item}
                </button>
              )
            )}
          </nav>

          <div className="p-4">
            <div className="rounded-3xl border bg-white p-4">
              <div className="text-xs text-slate-500">Signed in</div>
              <div className="text-sm font-semibold">admin (demo)</div>
              <button
                className="mt-3 w-full rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => openModal("Sign out")}
              >
                Sign out
              </button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1">
          {/* Top bar */}
          <div className="border-b">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <div className="text-xl font-semibold">Income</div>
                <div className="text-sm text-slate-600">Demo app shell • Modals confirm wiring</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                  onClick={() => openModal("New Draft")}
                >
                  New Draft
                </button>
                <button
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  onClick={() => openModal("Add Entry")}
                >
                  Add Entry
                </button>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* KPI cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { label: "Today", value: "$420" },
                { label: "This Week", value: "$1,780" },
                { label: "This Month", value: "$6,240" },
                { label: "YTD", value: "$38,200" },
              ].map((k) => (
                <div key={k.label} className="rounded-3xl border p-5">
                  <div className="text-xs text-slate-500">{k.label}</div>
                  <div className="mt-2 text-2xl font-semibold">{k.value}</div>
                </div>
              ))}
            </div>

            {/* Drafts + Workspace */}
            <div className="grid gap-6 lg:grid-cols-12">
              <div className="rounded-3xl border p-5 lg:col-span-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Draft Batches</div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                    Demo
                  </span>
                </div>

                <div className="mt-4 space-y-2">
                  {["Sunday Service", "Midweek", "Special Event"].map((name) => (
                    <button
                      key={name}
                      className="w-full rounded-2xl border bg-white px-4 py-3 text-left text-sm hover:bg-slate-50"
                      onClick={() => openModal(`Open Draft: ${name}`)}
                    >
                      <div className="font-medium">{name}</div>
                      <div className="mt-1 text-xs text-slate-600">2 items • $195 • Updated just now</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border p-5 lg:col-span-8">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold">Draft: Sunday Service</div>
                    <div className="text-xs text-slate-600">Auto-saved • Editable</div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                      onClick={() => openModal("Quick Add Member")}
                    >
                      Quick Add Member
                    </button>
                    <button
                      className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                      onClick={() => openModal("Publish Draft")}
                    >
                      Publish
                    </button>
                  </div>
                </div>

                <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
                  Entries table will go here next. For now, click actions to confirm UI flow.
                </div>

                <div className="mt-4 flex gap-2">
                  <button
                    className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                    onClick={() => openModal("Edit Entry")}
                  >
                    Edit Entry
                  </button>
                  <button
                    className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                    onClick={() => openModal("Delete Entry")}
                  >
                    Delete Entry
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <CoolModal open={open} title={modalTitle} onClose={() => setOpen(false)} />
    </div>
  );
}
