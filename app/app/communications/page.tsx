"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getActiveOrgId } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";

type Role = "owner" | "admin" | "finance" | "viewer" | "member";

const items: Array<{
  title: string;
  description: string;
  href: string;
  badge: string;
  disabled: boolean;
}> = [
  {
    title: "Forms",
    description: "Create and manage forms, questions, and availability.",
    href: "/app/communications/forms",
    badge: "",
    disabled: false,
  },
  {
    title: "Email",
    description:
      "Compose announcements and send email broadcasts to your church community.",
    href: "/app/communications/email",
    badge: "",
    disabled: false,
  },
  {
    title: "SMS",
    description: "Prepare text-message campaigns, consent, and provider readiness.",
    href: "/app/communications/sms",
    badge: "New",
    disabled: false,
  },
];

export default function CommunicationsHomePage() {
  const router = useRouter();
  const orgId = getActiveOrgId();
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!orgId) {
        if (alive) {
          setError("No active organization selected.");
          setLoading(false);
        }
        return;
      }

      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) {
        if (alive) {
          setError("Please sign in again.");
          setLoading(false);
        }
        return;
      }

      const { data, error: membershipError } = await supabase
        .from("user_organizations")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", userId)
        .maybeSingle();

      if (!alive) return;
      setRole((data?.role as Role | undefined) ?? null);
      setError(membershipError?.message ?? "");
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [orgId]);

  const allowed = role === "owner" || role === "admin" || role === "finance";

  return (
    <>
      <div className="border-b">
        <div className="px-6 py-4">
          <div className="text-xl font-semibold">Communications</div>
          <div className="text-sm text-slate-600">
            Create forms and communicate with your church community.
          </div>
          {error ? (
            <div className="mt-2 text-xs text-rose-600">{error}</div>
          ) : null}
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-7xl">
          <div className="rounded-3xl border bg-white">
            <div className="border-b px-5 py-4">
              <div className="text-sm font-semibold">
                WHAT WOULD YOU LIKE TO MANAGE?
              </div>
            </div>

            <div className="divide-y">
              {items.map((item) => {
                const locked = !loading && !allowed;
                const blocked = item.disabled || locked;

                return (
                  <button
                    key={item.href}
                    type="button"
                    disabled={blocked}
                    title={
                      item.disabled
                        ? "Coming soon."
                        : locked
                          ? "Finance, admins, and owners only."
                          : ""
                    }
                    onClick={() => {
                      if (!blocked) router.push(item.href);
                    }}
                    className={`w-full px-5 py-4 text-left ${
                      blocked
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold">
                            {item.title}
                          </div>
                          {item.badge ? (
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                                item.badge === "New"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-slate-50 text-slate-600"
                              }`}
                            >
                              {item.badge}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-1 text-sm text-slate-600">
                          {item.description}
                        </div>
                        {locked ? (
                          <div className="mt-2 text-xs text-amber-800">
                            Finance, admins, and owners only.
                          </div>
                        ) : null}
                        {item.disabled ? (
                          <div className="mt-2 text-xs text-slate-500">
                            This feature isn’t available yet.
                          </div>
                        ) : null}
                      </div>

                      <div className="text-sm text-slate-500">›</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
