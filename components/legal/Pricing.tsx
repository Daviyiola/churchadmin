// app/pricing/page.tsx
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import BackButton from "@/components/BackButton";

export const metadata = {
  title: "Pricing • Church Admin",
  description: "Subscription plans and feature limits for Church Admin.",
};

type Plan = {
  name: string;
  price: string;
  tagline: string;
  badge?: string;
  cta: { label: string; href: string };
  includes: string[];
  limits?: string[];
  footnote?: string;
};

const PLANS: Plan[] = [
  {
    name: "Free",
    price: "$0/mo",
    tagline: "For evaluation and very small teams.",
    cta: { label: "Get started", href: "/app" },
    includes: [
      "One (1) Finance role user",
      "Data entry for income and expense records",
      "Dashboard access and quick reporting (most recent 90 days)",
      "Up to 50 active People records",
      "Up to 100 outbound emails per month",
      "Limited category creation (income and expense)",
    ],
    limits: [
      "Data retention limited to 90 days",
      "No administrative roles",
      "No PDF income statements or detailed member reports",
      "No broadcast email campaigns beyond monthly quota",
      "No advanced administrative or workflow features",
      "No SLA / uptime guarantees",
    ],
  },
  {
    name: "Basic",
    price: "$29.99/mo",
    tagline: "For small churches with basic admin structure.",
    badge: "Most popular",
    cta: { label: "Start Basic", href: "/app" },
    includes: [
      "1 Owner role",
      "Up to 3 Admin roles",
      "Up to 6 additional Finance or Member roles",
      "Up to 300 active People records",
      "Up to 1,000 outbound emails per month",
      "PDF income statements and reporting",
      "Expanded category limits",
      "Extended data retention (up to 2 years)",
    ],
  },
  {
    name: "Pro",
    price: "$59.99/mo",
    tagline: "For growing churches with departments and teams.",
    cta: { label: "Go Pro", href: "/app" },
    includes: [
      "Up to 3 Owner roles",
      "Up to 7 Admin roles",
      "Up to 15 additional Finance/Admin roles",
      "Up to 1,000 active People records",
      "Up to 3,000 outbound emails per month",
      "Advanced reporting and PDF exports",
      "Expanded department/unit management",
      "Extended data retention (up to 5 years)",
    ],
  },
  {
    name: "Enterprise",
    price: "$119.99/mo",
    tagline: "For large or multi-campus churches.",
    cta: { label: "Contact sales", href: "/contact" },
    includes: [
      "Up to 10 Owner roles",
      "Up to 15 Admin roles",
      "Up to 25 additional Finance/Member roles",
      "Up to 3,500 active People records",
      "Up to 10,000 outbound emails per month",
      "Priority support",
      "Advanced reporting capabilities",
      "Unlimited category creation",
      "Extended or unlimited data retention",
    ],
    footnote:
      "Enterprise data retention and support terms may be customized by agreement.",
  },
];

function Check() {
  return (
    <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full border bg-slate-50 text-xs">
      ✓
    </span>
  );
}

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      {/* Top nav */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandLogo size={45} />
            <div>
              <div className="text-lg font-semibold leading-tight">
                Church Admin
              </div>
              <div className="text-sm text-slate-500">
                Subscription Plans
              </div>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            <Link
              className="text-sm text-slate-600 hover:text-slate-900"
              href="/privacy"
            >
              Privacy
            </Link>
            <Link
              className="text-sm text-slate-600 hover:text-slate-900"
              href="/terms"
            >
              Terms
            </Link>
            <BackButton />
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pt-16 pb-10">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
            Pricing that scales with your church
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600">
            Choose a plan based on your team size, people records, reporting needs,
            and data retention requirements.
          </p>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/app"
              className="inline-flex items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Sign in / Get started
            </Link>
            <Link
              href="/contact"
              className="inline-flex items-center justify-center rounded-2xl border px-5 py-3 text-sm font-semibold hover:bg-slate-50"
            >
              Talk to us
            </Link>
          </div>

          <div className="mt-6 text-xs text-slate-500">
            All plans include secure authentication (Supabase) and role-based access.
          </div>
        </div>
      </section>

      {/* Plans */}
      <section className="mx-auto max-w-6xl px-6 pb-12">
        <div className="grid gap-4 lg:grid-cols-4">
          {PLANS.map((p) => {
            const isPopular = p.badge?.toLowerCase().includes("popular");
            return (
              <div
                key={p.name}
                className={`relative rounded-3xl border bg-white p-6 shadow-sm ${
                  isPopular ? "border-slate-900" : ""
                }`}
              >
                {p.badge ? (
                  <div className="absolute right-4 top-4 rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">
                    {p.badge}
                  </div>
                ) : null}

                <div className="text-sm font-semibold">{p.name}</div>
                <div className="mt-2 text-3xl font-semibold tracking-tight">
                  {p.price}
                </div>
                <div className="mt-2 text-sm text-slate-600">{p.tagline}</div>

                <div className="mt-5">
                  <Link
                    href={p.cta.href}
                    className={`inline-flex w-full items-center justify-center rounded-2xl px-4 py-3 text-sm font-semibold ${
                      isPopular
                        ? "bg-slate-900 text-white hover:bg-slate-800"
                        : "border hover:bg-slate-50"
                    }`}
                  >
                    {p.cta.label}
                  </Link>
                </div>

                <div className="mt-6">
                  <div className="text-xs font-semibold text-slate-700">
                    Includes
                  </div>
                  <ul className="mt-3 space-y-2">
                    {p.includes.map((x) => (
                      <li key={x} className="flex gap-2 text-sm text-slate-700">
                        <Check />
                        <span>{x}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {p.limits?.length ? (
                  <div className="mt-6">
                    <div className="text-xs font-semibold text-slate-700">
                      Limitations
                    </div>
                    <ul className="mt-3 space-y-2">
                      {p.limits.map((x) => (
                        <li key={x} className="flex gap-2 text-sm text-slate-600">
                          <span className="mt-[2px] inline-flex h-5 w-5 items-center justify-center rounded-full border bg-white text-xs">
                            —
                          </span>
                          <span>{x}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {p.footnote ? (
                  <div className="mt-6 text-xs text-slate-500">{p.footnote}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      {/* Definitions & enforcement */}
      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border bg-slate-50 p-6 lg:col-span-2">
            <div className="text-sm font-semibold">Definition of “People Records”</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              For pricing and usage purposes, “People records” include members,
              visitors, and archived contacts maintained within the system.
              Only active People records count toward subscription limits.
            </p>
          </div>

          <div className="rounded-3xl border bg-slate-50 p-6">
            <div className="text-sm font-semibold">Plan changes &amp; enforcement</div>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li className="flex gap-2">
                <Check />
                <span>Feature access is restricted when usage limits are exceeded.</span>
              </li>
              <li className="flex gap-2">
                <Check />
                <span>Upgrading increases limits and features immediately.</span>
              </li>
              <li className="flex gap-2">
                <Check />
                <span>Downgrading may restrict access above the new tier.</span>
              </li>
              <li className="flex gap-2">
                <Check />
                <span>We may update pricing/limits with reasonable notice.</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 text-xs text-slate-500">
          Questions?{" "}
          <Link href="/contact" className="underline hover:text-slate-900">
            Contact us
          </Link>
          . By subscribing, you agree to our{" "}
          <Link href="/terms" className="underline hover:text-slate-900">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="underline hover:text-slate-900">
            Privacy Policy
          </Link>
          .
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t">
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm text-slate-600">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>© {new Date().getFullYear()} churchadmin</div>
            <div className="flex gap-4">
              <Link className="text-slate-500 hover:text-slate-900" href="/privacy">
                Privacy
              </Link>
              <Link className="text-slate-500 hover:text-slate-900" href="/terms">
                Terms
              </Link>
              <Link className="text-slate-500 hover:text-slate-900" href="/pricing">
                Pricing
              </Link>
              <Link className="text-slate-500 hover:text-slate-900" href="/contact">
                Contact
              </Link>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
