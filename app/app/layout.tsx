"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import {
  getActiveOrgRole,
  getUserId,
  signOut,
  getActiveOrgId,
} from "@/lib/auth";
import Image from "next/image";
import BrandLogo from "@/components/BrandLogo";
import { applyOrgTheme } from "@/lib/theme/applyOrgTheme";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [ready, setReady] = useState(false);
  const [orgName, setOrgName] = useState<string>("");
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [useDefaultLogo, setUseDefaultLogo] = useState(true);

  const [meId, setMeId] = useState<string | null>(null);
  const [meEmail, setMeEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setMeId(data.session?.user?.id ?? null);
      setMeEmail(data.session?.user?.email ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setMeId(session?.user?.id ?? null);
      setMeEmail(session?.user?.email ?? null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const role = useMemo(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("active_org_role");
  }, [ready]);

  const navItems = useMemo(
    () => [
      { label: "Dashboard", href: "/app" },
      { label: "Income", href: "/app/income" },
      { label: "Expense", href: "/app/expense" },
      { label: "Attendance", href: "/app/attendance" },
      { label: "People", href: "/app/people" },
      { label: "Categories", href: "/app/categories" },
      { label: "Reports", href: "/app/reports" },
      { label: "Settings", href: "/app/settings" },
    ],
    [],
  );

  const check = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const orgId = getActiveOrgId();

    if (!data.session || !orgId) {
      router.replace("/signin");
      return;
    }

    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", orgId)
      .maybeSingle();

    if (orgErr) console.log("orgErr", orgErr);

    const { data: settings, error: setErr } = await supabase
      .from("organization_settings")
      .select(
        "logo_path, use_default_logo, primary_rgb, primary_hover_rgb, accent_rgb",
      )
      .eq("organization_id", orgId)
      .maybeSingle();

    if (setErr) console.log("settingsErr", setErr);

    setOrgName(org?.name ?? "");
    setLogoPath(settings?.logo_path ?? null);
    setUseDefaultLogo(settings?.use_default_logo ?? true);

    applyOrgTheme(settings ?? {});
    setReady(true);
  }, [router]);

  useEffect(() => {
    (async () => {
      await check();
    })();
  }, [check]);

  useEffect(() => {
    const onUpdate = () => check();
    window.addEventListener("org-settings-updated", onUpdate);
    return () => window.removeEventListener("org-settings-updated", onUpdate);
  }, [check]);

  if (!ready) {
    return <div className="p-10 text-slate-700">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-72 border-r bg-slate-50">
          <div className="p-5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 overflow-hidden flex items-center justify-center">
                {useDefaultLogo || !logoPath ? (
                  <BrandLogo size={40} />
                ) : (
                  <Image
                    src={
                      supabase.storage.from("org-logos").getPublicUrl(logoPath)
                        .data.publicUrl
                    }
                    alt={orgName}
                    width={96}
                    height={40}
                    className="object-contain"
                  />
                )}
              </div>
              <div>
                <div className="text-sm font-semibold leading-tight">
                  {orgName}
                </div>
              </div>
            </div>
          </div>

          <nav className="px-3 pb-6 space-y-1">
            {navItems.map((item) => {
              const active =
                item.href === "/app"
                  ? pathname === "/app"
                  : pathname === item.href ||
                    pathname.startsWith(item.href + "/");

              return (
                <button
                  key={item.label}
                  className={[
                    "w-full rounded-2xl px-3 py-2 text-left text-sm transition",
                    active
                      ? "bg-primary text-white"
                      : "text-slate-800 hover:bg-white",
                  ].join(" ")}
                  onClick={() => router.push(item.href)}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="p-4">
            <div className="rounded-3xl border bg-white p-4">
              <div className="text-xs text-slate-500">Signed in</div>
              <div className="text-sm font-semibold truncate">
                {meEmail ?? "—"}
                {/* <span className="text-slate-500"> ({role ?? "member"})</span> */}
              </div>

              <button
                className="mt-3 w-full rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={async () => {
                  await signOut();
                  router.push("/signin");
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
