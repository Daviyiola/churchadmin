import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* Top nav */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandLogo size={45} className="" />
            <div>
              <div className="text-lg font-semibold leading-tight">Church Admin</div>
              <div className="text-sm text-slate-500">Church Operations Simplified</div>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            {/* <Link className="text-sm text-slate-600 hover:text-slate-900" href="#features">
              Features
            </Link>
            <Link className="text-sm text-slate-600 hover:text-slate-900" href="#workflows">
              Workflows
            </Link> */}
            {/* <Link href="/signin" className="text-sm text-slate-600 hover:text-slate-900">Sign in</Link> */}
            <Link
              className="rounded-2xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
              href="/app"
            >
              Contact Us
            </Link>
            
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-10">
        <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
          <div>
            {/* <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-slate-600">
              <span className="h-2 w-2 rounded-full bg-primary" />
              Draft → Publish workflow (coming soon)
            </div> */}

            <h1 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
              A modern admin dashboard for churches.
            </h1>

            <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">
              Track income, expenses, members, categories, attendance, reports, and more —
              with clean UI and reliable workflows.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/app"
                className="inline-flex items-center justify-center rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Sign into your Organization
              </Link>
              <a
                href="#features"
                className="inline-flex items-center justify-center rounded-2xl border px-5 py-3 text-sm font-semibold hover:bg-slate-50"
              >
                See features
              </a>
            </div>

            <div className="mt-6 text-xs text-slate-500">
              Multi-tenant ready • Themeable per church • Built for speed and clarity
            </div>
          </div>

          {/* Preview card */}
          <div className="rounded-3xl border bg-gradient-to-b from-slate-50 to-white p-4 shadow-sm">
            <div className="rounded-2xl border bg-white p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold">Dashboard Preview</div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                  Demo
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { label: "This Month Income", value: "$6,240" },
                  { label: "This Month Expense", value: "$2,890" },
                  { label: "Net", value: "$3,350" },
                  { label: "Members", value: "128" },
                ].map((k) => (
                  <div key={k.label} className="rounded-2xl border p-3">
                    <div className="text-xs text-slate-500">{k.label}</div>
                    <div className="mt-1 text-lg font-semibold">{k.value}</div>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border p-3">
                <div className="text-xs font-semibold text-slate-700">Recent Activity</div>
                <div className="mt-2 space-y-2">
                  {[
                    "Income • Offerings • $120",
                    "Expense • Utilities • $65",
                    "Income • Tithes • $75",
                  ].map((t) => (
                    <div key={t} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-sm text-slate-700">{t}</div>
                      <div className="h-2 w-2 rounded-full bg-slate-400" />
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex gap-2">
                <div className="flex-1 rounded-2xl bg-primary px-4 py-2 text-center text-sm font-semibold text-white">
                  New Entry
                </div>
                <div className="flex-1 rounded-2xl border px-4 py-2 text-center text-sm font-semibold">
                  Reports
                </div>
              </div>
            </div>

            {/* <div className="mt-3 text-center text-xs text-slate-500">
              Real app UI will look like this demo style.
            </div> */}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-12">
        <h2 className="text-2xl font-semibold tracking-tight">Built around real workflows</h2>
        <p className="mt-2 max-w-2xl text-slate-600">
          Everything is designed so admins can enter data fast, avoid mistakes, and generate reports confidently.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { title: "Draft → Publish", desc: "Enter multiple records safely, review, then publish to reports." },
            { title: "Quick Add", desc: "Add Members/Categories inside entry flow without breaking your rhythm." },
            { title: "Roles & Permissions", desc: "Admin vs users, with audit-friendly workflows." },
            { title: "Themeable per Church", desc: "Brand colors and logo can be customized per tenant." },
            { title: "Clean Reports", desc: "Reports pull from published data for consistency." },
            { title: "Modern UI", desc: "Tabs, cards, search, and predictable navigation." },
          ].map((f) => (
            <div key={f.title} className="rounded-3xl border p-5">
              <div className="text-base font-semibold">{f.title}</div>
              <div className="mt-2 text-sm leading-relaxed text-slate-600">{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Workflows */}
      {/* <section id="workflows" className="mx-auto max-w-6xl px-6 pb-16">
        <div className="rounded-3xl border bg-slate-50 p-6">
          <h3 className="text-lg font-semibold">Try the demo flow</h3>
          <p className="mt-2 text-sm text-slate-600">
            Open the demo and click around. Every primary action will open a modal that confirms the UI wiring works.
          </p>
          <div className="mt-5">
            <Link
              href="/app"
              className="inline-flex items-center justify-center rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Open Demo
            </Link>
          </div>
        </div>
      </section> */}

      {/* Footer */}
      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-600">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>© {new Date().getFullYear()} churchadmin</div>
            <div className="flex gap-4">
              <span className="text-slate-500">Privacy</span>
              <span className="text-slate-500">Terms</span>
              <span className="text-slate-500">Contact</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
