import type { ReactNode } from "react";

type BaseProps<T> = {
  children: ReactNode;
} & React.HTMLAttributes<T>;

export function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-base font-semibold tracking-tight text-slate-900 sm:text-lg">
        {title}
      </h2>
      <div className="mt-3 space-y-4 text-sm leading-6 text-slate-700">
        {children}
      </div>
    </section>
  );
}

export function P({ children, className = "", ...rest }: BaseProps<HTMLParagraphElement>) {
  return (
    <p className={`text-sm leading-6 text-slate-700 ${className}`} {...rest}>
      {children}
    </p>
  );
}

export function Ul({ children, className = "", ...rest }: BaseProps<HTMLUListElement>) {
  return (
    <ul
      className={`ml-5 list-disc space-y-2 text-sm leading-6 text-slate-700 ${className}`}
      {...rest}
    >
      {children}
    </ul>
  );
}

export function Li({ children, className = "", ...rest }: BaseProps<HTMLLIElement>) {
  return (
    <li className={className} {...rest}>
      {children}
    </li>
  );
}

export function Divider() {
  return <div className="border-t" />;
}

export function Toc({
  items,
  className = "",
}: {
  items: { id: string; label: string }[];
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border bg-white p-4 ${className}`}>
      <div className="text-sm font-semibold text-slate-900">On this page</div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            className="rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 hover:text-slate-900"
          >
            {it.label}
          </a>
        ))}
      </div>
    </div>
  );
}
