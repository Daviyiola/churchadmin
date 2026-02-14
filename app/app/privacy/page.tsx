import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import PrivacyContent from "@/components/legal/PrivacyContent";

export const metadata = {
  title: "Privacy Policy | Church Admin",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandLogo size={38} />
            <div>
              <div className="text-base font-semibold leading-tight">Church Admin</div>
              <div className="text-xs text-slate-500">Privacy Policy</div>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            <Link className="text-sm text-slate-600 hover:text-slate-900" href="/terms">
              Terms
            </Link>
            <Link
              className="rounded-2xl border px-4 py-2 text-sm font-medium hover:bg-slate-50"
              href="/"
            >
              Back
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-10">
        <div className="rounded-3xl border bg-white p-6 shadow-sm">
          <PrivacyContent />
        </div>
      </section>
    </main>
  );
}
