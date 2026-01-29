"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Gender = "male" | "female";
type AgeGroup = "1-12" | "13-17" | "18-35" | "36+";

type PrayerItem = { id: string; text: string };

function isGender(v: string): v is Gender {
  return v === "male" || v === "female";
}
function isAgeGroup(v: string): v is AgeGroup {
  return v === "1-12" || v === "13-17" || v === "18-35" || v === "36+";
}
function makeId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}
function normalizeEmail(v: string) {
  return v.trim().toLowerCase();
}
function isValidEmail(v: string) {
  const e = normalizeEmail(v);
  return e.includes("@") && e.includes(".");
}
function toPrayerItems(tags?: string[] | null): PrayerItem[] {
  const clean = (tags ?? []).map((t) => String(t).trim()).filter(Boolean);
  return clean.length
    ? clean.map((t) => ({ id: makeId(), text: t }))
    : [{ id: makeId(), text: "Prayer for my family" }];
}
function fromPrayerItems(items: PrayerItem[]): string[] | null {
  const clean = items.map((x) => x.text.trim()).filter(Boolean);
  return clean.length ? clean : null;
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-medium">{children}</label>;
}

function Input({
  value,
  onChange,
  placeholder,
  autoComplete,
  inputMode,
  type,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type ?? "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete={autoComplete}
      inputMode={inputMode}
      disabled={disabled}
      className={[
        "mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none",
        disabled
          ? "bg-slate-100 text-slate-500 cursor-not-allowed"
          : "bg-white/90 focus:ring-2 focus:ring-slate-200",
      ].join(" ")}
    />
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="mt-2 w-full rounded-2xl border bg-white/90 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
    >
      {children}
    </select>
  );
}

function PrayerLine({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full border-0 bg-transparent px-0 py-2 text-sm outline-none focus:ring-0"
      style={{
        backgroundImage:
          "linear-gradient(to bottom, transparent 0, transparent calc(100% - 1px), rgb(226 232 240) calc(100% - 1px), rgb(226 232 240) 100%)",
        backgroundSize: "100% 2.25rem",
        lineHeight: "2.25rem",
      }}
    />
  );
}

function AlertError({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {children}
    </div>
  );
}

// ---- API types ----
type CampaignLookupOk = {
  ok: true;
  org: { id: string; name: string };
  campaign: { id: string; name: string; slug: string };
  settings?: { logo_path: string | null; use_default_logo: boolean };
};

type CampaignLookupError = { error: string };
type CampaignLookupResponse = CampaignLookupOk | CampaignLookupError;

export default function CampaignIntakeClient({ slug }: { slug: string }) {
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");
  const [done, setDone] = useState(false);

  const [orgName, setOrgName] = useState("");
  const [campaignName, setCampaignName] = useState("");

  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [useDefaultLogo, setUseDefaultLogo] = useState(true);

  // form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  const [email, setEmail] = useState(""); // shared link -> user enters it
  // If you REALLY want email disabled, set disabledEmail=true
  const disabledEmail = false;

  const [phone, setPhone] = useState("");
  const [gender, setGender] = useState<Gender | "">("");
  const [ageGroup, setAgeGroup] = useState<AgeGroup | "">("");
  const [address, setAddress] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [childrenCount, setChildrenCount] = useState<string>("0");
  const [howHeard, setHowHeard] = useState("");
  const [prayerItems, setPrayerItems] = useState<PrayerItem[]>(toPrayerItems());

  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const logoUrl = useMemo(() => {
    if (!logoPath) return null;
    return supabase.storage.from("org-logos").getPublicUrl(logoPath).data.publicUrl;
  }, [logoPath]);

  useEffect(() => {
    if (!slug) return;

    let cancelled = false;

    async function run() {
      setLoading(true);
      setPageErr("");

      try {
        const res = await fetch(
          `/api/intake/campaign/lookup?slug=${encodeURIComponent(slug)}`
        );

        const json = (await res.json().catch(() => null)) as
          | CampaignLookupOk
          | { error: string }
          | null;

        if (!res.ok) {
          throw new Error(json && "error" in json ? json.error : "Invalid or expired link.");
        }

        if (!json || !("ok" in json) || json.ok !== true) {
          throw new Error("Invalid or expired link.");
        }

        if (cancelled) return;

        setOrgName(json.org?.name ?? "");
        setCampaignName(json.campaign?.name ?? "");

        setLogoPath(json.settings?.logo_path ?? null);
        setUseDefaultLogo(json.settings?.use_default_logo ?? true);

        // shared campaign: do NOT prefill prayer tags
        setPrayerItems(toPrayerItems(null));
      } catch (e) {
        if (!cancelled) setPageErr(e instanceof Error ? e.message : "Invalid link.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const canSubmit = useMemo(() => {
    if (!slug) return false;

    if (!firstName.trim()) return false;
    if (!lastName.trim()) return false;

    if (!disabledEmail && !isValidEmail(email)) return false;

    if (!phone.trim()) return false;
    if (!gender) return false;
    if (!ageGroup) return false;
    if (!address.trim()) return false;
    if (!maritalStatus.trim()) return false;

    const cc = childrenCount.trim() === "" ? NaN : Number(childrenCount);
    if (!Number.isFinite(cc) || cc < 0) return false;

    return true;
  }, [
    slug,
    firstName,
    lastName,
    email,
    disabledEmail,
    phone,
    gender,
    ageGroup,
    address,
    maritalStatus,
    childrenCount,
  ]);

  async function submit() {
    setSaveErr("");

    if (!firstName.trim()) return setSaveErr("First name is required.");
    if (!lastName.trim()) return setSaveErr("Last name is required.");

    if (!disabledEmail && !isValidEmail(email)) {
      return setSaveErr("Please enter a valid email.");
    }

    if (!phone.trim()) return setSaveErr("Phone is required.");
    if (!gender) return setSaveErr("Gender is required.");
    if (!ageGroup) return setSaveErr("Age group is required.");
    if (!address.trim()) return setSaveErr("Home address is required.");
    if (!maritalStatus.trim()) return setSaveErr("Marital status is required.");

    const cc = childrenCount.trim() === "" ? NaN : Number(childrenCount);
    if (!Number.isFinite(cc) || cc < 0) {
      return setSaveErr("Children count must be a valid non-negative number.");
    }

    setSaving(true);
    try {
      const payload = {
        slug,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: disabledEmail ? null : normalizeEmail(email),
        phone: phone.trim(),
        gender,
        age_group: ageGroup,
        address: address.trim(),
        marital_status: maritalStatus.trim(),
        children_count: cc,
        how_heard: howHeard.trim() || "",
        prayer_request_tags: fromPrayerItems(prayerItems),
      };

      const res = await fetch("/api/intake/campaign/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(String(json?.error ?? "Failed to submit."));

      setDone(true);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Failed to submit.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="relative min-h-screen bg-slate-50 text-slate-900">
      {/* subtle background depth */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-10 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute left-1/3 top-56 h-[280px] w-[280px] -translate-x-1/2 rounded-full bg-slate-900/5 blur-3xl" />
      </div>

      {/* Header */}
      <header className="border-b bg-white backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3">
            {!useDefaultLogo && logoUrl ? (
              <div className="h-11 w-11 overflow-hidden bg-white flex items-center justify-center">
                <Image
                  src={logoUrl}
                  alt={orgName || "Church logo"}
                  width={44}
                  height={44}
                  className="h-11 w-11 object-contain"
                />
              </div>
            ) : null}

            <div>
              <div className="text-xl font-semibold leading-tight">
                {orgName || "Guest form"}
              </div>
              <div className="text-sm text-slate-500">Guest form</div>
            </div>
          </Link>

          <div className="text-sm text-slate-600">
            {campaignName ? campaignName : orgName ? "We’re glad you’re here." : ""}
          </div>
        </div>
      </header>

      {/* States */}
      {loading ? (
        <section className="mx-auto max-w-md px-6 pt-14 pb-16">
          <div className="text-sm text-slate-600">Loading…</div>
        </section>
      ) : pageErr ? (
        <section className="mx-auto max-w-md px-6 pt-14 pb-16">
          <h1 className="text-3xl font-semibold tracking-tight">Link not valid</h1>
          <p className="mt-2 text-slate-600">{pageErr}</p>
        </section>
      ) : done ? (
        <section className="mx-auto max-w-md px-6 pt-14 pb-16">
          <h1 className="text-3xl font-semibold tracking-tight">Thank you!</h1>
          <p className="mt-2 text-slate-600">Your form has been submitted successfully.</p>
        </section>
      ) : (
        <section className="mx-auto max-w-2xl px-6 pt-12 pb-16 mt-10">
          <h1 className="text-3xl font-semibold tracking-tight">
            Thank you for joining us today!
          </h1>
          <p className="mt-2 text-slate-600">
            Your presence was truly refreshing. Please take a few minutes to complete your details.
          </p>

          <div className="mt-8 rounded-3xl border bg-white/80 p-6 shadow-sm backdrop-blur">
            {saveErr ? (
              <div className="mb-5">
                <AlertError>{saveErr}</AlertError>
              </div>
            ) : null}

            {/* Identity */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>First name *</Label>
                <Input
                  value={firstName}
                  onChange={setFirstName}
                  placeholder="First name"
                  autoComplete="given-name"
                />
              </div>

              <div>
                <Label>Last name *</Label>
                <Input
                  value={lastName}
                  onChange={setLastName}
                  placeholder="Last name"
                  autoComplete="family-name"
                />
              </div>

              <div>
                <Label>Email *</Label>
                <Input
                  value={email}
                  onChange={disabledEmail ? () => {} : setEmail}
                  placeholder="you@example.com"
                  autoComplete="email"
                  inputMode="email"
                  disabled={disabledEmail}
                />
                {!disabledEmail && email.trim().length > 0 && !isValidEmail(email) ? (
                  <div className="mt-2 text-sm text-red-600">Enter a valid email.</div>
                ) : null}
              </div>

              <div>
                <Label>Phone *</Label>
                <Input
                  value={phone}
                  onChange={setPhone}
                  placeholder="(555) 555-5555"
                  autoComplete="tel"
                />
              </div>
            </div>

            {/* Demographics */}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Gender *</Label>
                <Select
                  value={gender}
                  onChange={(v) => setGender(v === "" ? "" : isGender(v) ? v : "")}
                >
                  <option value="">Select…</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </Select>
              </div>

              <div>
                <Label>Age group *</Label>
                <Select
                  value={ageGroup}
                  onChange={(v) => setAgeGroup(v === "" ? "" : isAgeGroup(v) ? v : "")}
                >
                  <option value="">Select…</option>
                  <option value="1-12">1 to 12</option>
                  <option value="13-17">13 to 17</option>
                  <option value="18-35">18 to 35</option>
                  <option value="36+">36 and above</option>
                </Select>
              </div>
            </div>

            {/* Address */}
            <div className="mt-6">
              <Label>Home address *</Label>
              <Input
                value={address}
                onChange={setAddress}
                placeholder="Street address"
                autoComplete="street-address"
              />
            </div>

            {/* Family */}
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Marital status *</Label>
                <Input
                  value={maritalStatus}
                  onChange={setMaritalStatus}
                  placeholder="e.g., Single, Married"
                />
              </div>

              <div>
                <Label>Children count *</Label>
                <Input
                  value={childrenCount}
                  onChange={setChildrenCount}
                  placeholder="0"
                  inputMode="numeric"
                />
              </div>
            </div>

            {/* How heard */}
            <div className="mt-6">
              <Label>How did you hear about us?</Label>
              <Input
                value={howHeard}
                onChange={setHowHeard}
                placeholder="Invited by a friend, social media, flyer..."
              />
            </div>

            {/* Prayer requests */}
            <div className="mt-8">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">Prayer requests</div>
                  <div className="mt-1 text-sm text-slate-600">Add as many as you’d like.</div>
                </div>

                <button
                  type="button"
                  className="text-sm font-semibold text-primary hover:opacity-90"
                  onClick={() =>
                    setPrayerItems((cur) => [...cur, { id: makeId(), text: "" }])
                  }
                >
                  + New prayer request
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {prayerItems.map((it, idx) => (
                  <div key={it.id} className="flex items-center gap-3">
                    <div className="flex-1">
                      <PrayerLine
                        value={it.text}
                        onChange={(v) =>
                          setPrayerItems((cur) =>
                            cur.map((x) => (x.id === it.id ? { ...x, text: v } : x))
                          )
                        }
                        placeholder={idx === 0 ? "Family" : "Add a prayer request…"}
                      />
                    </div>

                    {prayerItems.length > 1 ? (
                      <button
                        type="button"
                        className="text-xs text-slate-500 hover:text-slate-900"
                        onClick={() =>
                          setPrayerItems((cur) => cur.filter((x) => x.id !== it.id))
                        }
                        title="Remove"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {/* Submit */}
            <button
              disabled={saving || !canSubmit}
              onClick={submit}
              className="mt-8 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-95 disabled:opacity-50"
            >
              {saving ? "Submitting…" : "Submit"}
            </button>

            <div className="mt-4 text-xs text-slate-500">This is a shared campaign link.</div>
          </div>
        </section>
      )}
    </main>
  );
}
