import type { ReactNode } from "react";

export default function LegalLayout({
  title,
  subtitle,
  meta,
  children,
}: {
  title: string;
  subtitle?: string;
  meta?: ReactNode; // e.g. effective date + entity
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="rounded-3xl border bg-white shadow-sm">
        {/* Header */}
        <div className="border-b px-6 py-6 sm:px-8">
          <div className="text-2xl font-semibold tracking-tight">{title}</div>
          {subtitle ? (
            <div className="mt-1 text-sm text-slate-600">{subtitle}</div>
          ) : null}
          {meta ? (
            <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {meta}
            </div>
          ) : null}
        </div>

        {/* Body */}
        <div className="px-6 py-6 sm:px-8">
          <div className="space-y-10">{children}</div>
        </div>
      </div>
    </div>
  );
}
