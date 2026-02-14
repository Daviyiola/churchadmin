
import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import TermsContent from "@/components/legal/TermsContent";
import BackButton from "@/components/BackButton";

export const metadata = {
  title: "Terms of Service | Church Admin",
  description: "Church Admin Terms of Service",
};

export default function TermsPage() {

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandLogo size={40} />
            <div>
              <div className="text-base font-semibold leading-tight">
                Church Admin
              </div>
              <div className="text-xs text-slate-500">Church Operations Simplified</div>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            <Link
              href="/privacy"
              className="text-sm text-slate-600 hover:text-slate-900"
            >
              Privacy
            </Link>

            <BackButton />
          </nav>
        </div>
      </header>

      {/* Content */}
      <section className="mx-auto max-w-6xl px-6 py-12">
        <TermsContent />
      </section>

      {/* Footer */}
      <footer className="mt-16 border-t bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 text-sm text-slate-500">
          <div>© {new Date().getFullYear()} Church Admin</div>
          <div className="flex gap-6">
            <Link href="/privacy" className="hover:text-slate-900">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-slate-900">
              Terms
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
