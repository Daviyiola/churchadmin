"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import ContactForm from "@/components/ContactForm";
import { useRouter } from "next/navigation";

export default function SettingsSupportPage() {
  const router = useRouter();
  const orgId = getActiveOrgId();

  const [prefill, setPrefill] = useState<{
    name?: string;
    email?: string;
    church?: string;
  }>({});

  useEffect(() => {
    let mounted = true;

    async function loadPrefill() {
      // email + name (if available)
      const { data } = await supabase.auth.getUser();
      const u = data.user;

      const email = u?.email ?? "";
      const name =
        (u?.user_metadata?.full_name as string | undefined) ||
        (u?.user_metadata?.name as string | undefined) ||
        "";

      let church = "";
      if (orgId) {
        const { data: org } = await supabase
          .from("organizations")
          .select("name")
          .eq("id", orgId)
          .maybeSingle();

        church = (org?.name as string) || "";
      }

      if (!mounted) return;
      setPrefill({
        name: name || undefined,
        email: email || undefined,
        church: church || undefined,
      });
    }

    loadPrefill();
    return () => {
      mounted = false;
    };
  }, [orgId]);

  return (
    <>
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Support</div>
            <div className="text-sm text-slate-600">
              Send a message to support. We’ll reply by email.
            </div>
          </div>

          <button
            className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
            onClick={() => router.push("/app/settings")}
          >
            Back to Settings
          </button>
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-7xl">
          <div className="max-w-2xl">
            <ContactForm
              variant="app"
              source="app-settings-support"
              showLegal={false}
              initialValues={prefill}
              lockEmail={true}
            />
          </div>
        </div>
      </div>
    </>
  );
}
