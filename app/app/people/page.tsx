"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";

type Role = "owner" | "admin" | "finance" | "viewer" | "member";

async function getMyRoleForOrg(orgId: string): Promise<{
  role: Role | null;
  userId: string | null;
  error: string | null;
}> {
  const { data: sessionRes, error: sessErr } = await supabase.auth.getSession();
  const userId = sessionRes.session?.user?.id ?? null;
  if (sessErr) return { role: null, userId, error: sessErr.message };
  if (!userId) return { role: null, userId: null, error: "No session user." };

  const { data, error } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .limit(1);

  if (error) return { role: null, userId, error: error.message };

  const role = (data?.[0]?.role as Role | undefined) ?? null;
  return { role, userId, error: null };
}

type PeopleNavItem = {
  title: string;
  desc: string;
  href: string;
  badge?: "" | "New" | "Coming soon";
  requiresAdmin: boolean; // owner/admin
  disabled?: boolean; // hard disabled (e.g., not built)
};

export default function PeopleHomePage() {
  const router = useRouter();

  const [role, setRole] = useState<Role | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [roleErr, setRoleErr] = useState<string>("");

  const orgId = getActiveOrgId();

  useEffect(() => {
    let alive = true;

    (async () => {
      if (!orgId) {
        if (!alive) return;
        setRoleLoaded(true);
        setRoleErr("No active organization selected.");
        return;
      }

      const res = await getMyRoleForOrg(orgId);
      if (!alive) return;

      setRole(res.role);
      setRoleErr(res.error ?? "");
      setRoleLoaded(true);
    })();

    return () => {
      alive = false;
    };
  }, [orgId]);

  const canManagePeople = useMemo(() => {
    return role === "owner" || role === "admin";
  }, [role]);

  const items: PeopleNavItem[] = useMemo(
    () => [
      {
        title: "Members",
        desc: "View and manage member profiles and contact info.",
        href: "/app/people/members",
        badge: "",
        requiresAdmin: false,
      },
      {
        title: "First-timers",
        desc: "Track new visitors, follow-ups, and who has joined over time.",
        href: "/app/people/first-timers",
        badge: "",
        requiresAdmin: false,
      },
      {
        title: "Email communications",
        desc: "Send announcements and broadcasts to members or visitors by email.",
        href: "/app/people/email-communications",
        badge: "",
        requiresAdmin: true,
      },
      {
        title: "SMS communications",
        desc: "Text message campaigns and reminders (coming soon).",
        href: "/app/people/sms-communications",
        badge: "Coming soon",
        requiresAdmin: true,
        disabled: true, // not built yet
      },
    ],
    [],
  );

  return (
    <>
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">People</div>
            <div className="text-sm text-slate-600">
              Manage members, first-timers, and communications.
            </div>
            {roleErr ? (
              <div className="mt-2 text-xs text-rose-600">{roleErr}</div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-7xl">
          <div className="rounded-3xl border bg-white">
            <div className="border-b px-5 py-4">
              <div className="text-sm font-semibold">WHAT WOULD YOU LIKE TO MANAGE?</div>
            </div>

            <div className="divide-y">
              {items.map((it) => {
                const locked =
                  it.requiresAdmin && roleLoaded && !canManagePeople;

                const blocked = it.disabled || locked;

                const tooltip = it.disabled
                  ? "Coming soon."
                  : locked
                    ? "Admins/Owners only. Ask an admin to grant access."
                    : "";

                return (
                  <button
                    key={it.href}
                    onClick={() => {
                      if (!blocked) router.push(it.href);
                    }}
                    disabled={blocked}
                    title={tooltip}
                    className={[
                      "w-full px-5 py-4 text-left",
                      blocked
                        ? "opacity-60 cursor-not-allowed"
                        : "hover:bg-slate-50",
                    ].join(" ")}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold">{it.title}</div>

                          {it.requiresAdmin ? (
                            <span
                              className={[
                                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                blocked && locked
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-slate-200 bg-slate-50 text-slate-600",
                              ].join(" ")}
                            >
                              {blocked && locked ? "Locked" : "Admin"}
                            </span>
                          ) : null}

                          {it.badge ? (
                            <span
                              className={[
                                "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                                it.badge === "New"
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                  : "border-slate-200 bg-slate-50 text-slate-600",
                              ].join(" ")}
                            >
                              {it.badge}
                            </span>
                          ) : null}
                        </div>

                        <div className="mt-1 text-sm text-slate-600">
                          {it.desc}
                        </div>

                        {it.disabled ? (
                          <div className="mt-2 text-xs text-slate-600">
                            This feature isn’t available yet.
                          </div>
                        ) : locked ? (
                          <div className="mt-2 text-xs text-amber-800">
                            Admins/Owners only. Ask an admin to grant access.
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

          <div className="mt-4 text-xs text-slate-500">
           
          </div>
        </div>
      </div>
    </>
  );
}
