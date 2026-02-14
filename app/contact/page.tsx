import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";
import ContactForm from "@/components/ContactForm";
import BackButton from "@/components/BackButton";

export const metadata = {
  title: "Contact • Church Admin",
  description: "Contact the Church Admin team.",
};

export default function ContactPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <BrandLogo size={40} />
            <div>
              <div className="text-base font-semibold leading-tight">Church Admin</div>
              <div className="text-xs text-slate-500">Contact</div>
            </div>
          </div>

          <nav className="flex items-center gap-3">
            <Link className="text-sm text-slate-600 hover:text-slate-900" href="/privacy">
              Privacy
            </Link>
            <Link className="text-sm text-slate-600 hover:text-slate-900" href="/terms">
              Terms
            </Link>
            <BackButton />
          </nav>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-12">
        <div className="mx-auto max-w-2xl">
          <ContactForm variant="public" source="public-contact-page" />
        </div>
      </section>
    </main>
  );
}
