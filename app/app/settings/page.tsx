"use client";

import { useRouter } from "next/navigation";

export default function SettingsHomePage() {
  const router = useRouter();

  const items = [
    {
      title: "Organization",
      desc: "Profile, branding, and report preferences.",
      href: "/app/settings/org",
    },
    {
      title: "Manage users",
      desc: "Invite people, manage roles, and remove access.",
      href: "/app/settings/users",
    },
  ];


  return (
    <>
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Settings</div>
            <div className="text-sm text-slate-600">
              Choose what you want to configure
            </div>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-7xl">
          <div className="rounded-3xl border bg-white">
            <div className="border-b px-5 py-4">
              <div className="text-xs font-semibold"></div>
              {/* <div className="mt-1 text-xs text-slate-600">
                More settings will appear here later.
              </div> */}
            </div>

            <div className="divide-y">
              {items.map((it) => (
                <button
                  key={it.href}
                  onClick={() => router.push(it.href)}
                  className="w-full px-5 py-4 text-left hover:bg-slate-50"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-sm font-semibold">{it.title}</div>
                      <div className="mt-1 text-sm text-slate-600">{it.desc}</div>
                    </div>
                    <div className="text-sm text-slate-500">›</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* <div className="mt-4 text-xs text-slate-500">
            You can add “Org profile”, “Permissions”, “Categories defaults”, etc. here later.
          </div> */}
        </div>
      </div>
    </>
  );
}
