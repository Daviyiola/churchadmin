"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import BrandLogo from "@/components/BrandLogo";
import { applyOrgTheme } from "@/lib/theme/applyOrgTheme";
import { hexToRgbTriplet, rgbTripletToHex } from "@/lib/utils/color";
import { useRouter } from "next/navigation";
import { setUnsaved } from "@/lib/unsaved";

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function Toast({ show, text }: { show: boolean; text: string }) {
  return (
    <div
      className={`fixed right-6 top-6 z-[9999] transition-all duration-300 ${
        show
          ? "opacity-100 translate-y-0"
          : "opacity-0 -translate-y-2 pointer-events-none"
      }`}
    >
      <div className="rounded-2xl border bg-white px-4 py-3 text-sm shadow-lg">
        {text}
      </div>
    </div>
  );
}

type OrgRow = { name: string; created_at: string };
type SettingsRow = {
  logo_path: string | null;
  use_default_logo: boolean | null;
  primary_rgb: string | null;

  report_header_text: string | null;
  report_subheader_text: string | null;
  report_banner_bg_rgb: string | null;
  report_banner_text_rgb: string | null;
};

export default function OrgSettingsPage() {
  const orgId = getActiveOrgId();
  const router = useRouter();

  const currentRole =
    typeof window !== "undefined"
      ? localStorage.getItem("active_org_role")
      : null;

  const canEdit = currentRole === "admin" || currentRole === "owner";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [org, setOrg] = useState<OrgRow | null>(null);

  // persisted settings
  const [saved, setSaved] = useState<SettingsRow | null>(null);

  // editable form state
  const [useDefaultLogo, setUseDefaultLogo] = useState(true);
  const [logoPath, setLogoPath] = useState<string | null>(null);

  const [primaryHex, setPrimaryHex] = useState<string>("#2f5e85"); // default-ish
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const [reportHeader, setReportHeader] = useState("");
  const [reportSubheader, setReportSubheader] = useState("");

  const [bannerBgHex, setBannerBgHex] = useState("#0f172a"); // slate-900-ish
  const [bannerTextHex, setBannerTextHex] = useState("#ffffff");

  const [saving, setSaving] = useState(false);

  // toast
  const [toastOpen, setToastOpen] = useState(false);
  const [toastText, setToastText] = useState("");

  const logoUrl = useMemo(() => {
    if (!logoPath) return null;
    const { data } = supabase.storage.from("org-logos").getPublicUrl(logoPath);
    return data.publicUrl || null;
  }, [logoPath]);

  const isDirty = useMemo(() => {
        if (!saved) return false;

        const savedPrimaryHex = rgbTripletToHex(saved.primary_rgb) ?? "#2f5e85";

        const savedBannerBgHex = rgbTripletToHex(saved.report_banner_bg_rgb) ?? rgbTripletToHex(saved.primary_rgb) ?? "#2f5e85";
        const savedBannerTextHex = rgbTripletToHex(saved.report_banner_text_rgb) ?? "#ffffff";

        return (
            useDefaultLogo !== !!saved.use_default_logo ||
            (useDefaultLogo ? false : (logoPath ?? null) !== (saved.logo_path ?? null)) ||
            pendingFile !== null ||
            primaryHex.toLowerCase() !== savedPrimaryHex.toLowerCase() ||
            reportHeader !== (saved.report_header_text ?? "") ||
            reportSubheader !== (saved.report_subheader_text ?? "") ||
            bannerBgHex.toLowerCase() !== savedBannerBgHex.toLowerCase() ||
            bannerTextHex.toLowerCase() !== savedBannerTextHex.toLowerCase()
        );
        }, [
        saved,
        useDefaultLogo,
        logoPath,
        pendingFile,
        primaryHex,
        reportHeader,
        reportSubheader,
        bannerBgHex,
        bannerTextHex,
        ]);

    useEffect(() => {
        setUnsaved(isDirty);
        return () => setUnsaved(false); // clear when leaving page / unmount
        }, [isDirty]);

  function showToast(text: string) {
    setToastText(text);
    setToastOpen(true);
    window.setTimeout(() => setToastOpen(false), 1600);
  }

  useEffect(() => {
    let alive = true;

    async function load() {
      if (!orgId) {
        setError("No active organization selected. Please sign in again.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      const { data: orgRow, error: orgErr } = await supabase
        .from("organizations")
        .select("name, created_at")
        .eq("id", orgId)
        .maybeSingle();

      if (orgErr) {
        if (!alive) return;
        setError(orgErr.message);
        setLoading(false);
        return;
      }

      const { data: setRow, error: setErr } = await supabase
        .from("organization_settings")
        .select(
          "logo_path, use_default_logo, primary_rgb, report_header_text, report_subheader_text, report_banner_bg_rgb, report_banner_text_rgb"
        )
        .eq("organization_id", orgId)
        .maybeSingle();

      if (setErr) {
        if (!alive) return;
        setError(setErr.message);
        setLoading(false);
        return;
      }

      if (!alive) return;

      setOrg(orgRow ?? null);

      const normalized: SettingsRow = {
        logo_path: setRow?.logo_path ?? null,
        use_default_logo: setRow?.use_default_logo ?? true,
        primary_rgb: setRow?.primary_rgb ?? null,

        report_header_text: setRow?.report_header_text ?? null,
        report_subheader_text: setRow?.report_subheader_text ?? null,
        report_banner_bg_rgb: setRow?.report_banner_bg_rgb ?? null,
        report_banner_text_rgb: setRow?.report_banner_text_rgb ?? null,
      };

      setSaved(normalized);

      // hydrate form state
      setLogoPath(normalized.logo_path);
      setUseDefaultLogo(!!normalized.use_default_logo);

      setReportHeader(normalized.report_header_text ?? "");
      setReportSubheader(normalized.report_subheader_text ?? "");

      const hex = rgbTripletToHex(normalized.primary_rgb);
      setPrimaryHex(hex ?? "#2f5e85");

      setBannerBgHex(
        rgbTripletToHex(normalized.report_banner_bg_rgb) ?? hex ?? "#0f172a"
      );
      setBannerTextHex(
        rgbTripletToHex(normalized.report_banner_text_rgb) ?? "#ffffff"
      );

      // Apply theme immediately based on stored setting (or keep defaults if null)
      applyOrgTheme({
        primary_rgb: normalized.primary_rgb,
      });

      setLoading(false);
    }

    load();
    return () => {
      alive = false;
    };
  }, [orgId]);

  // live preview of primary color while editing 
  useEffect(() => {
    const triplet = hexToRgbTriplet(primaryHex);
    if (triplet) applyOrgTheme({ primary_rgb: triplet });
  }, [primaryHex]);

  useEffect(() => {
    return () => {
        // revert to saved on leaving page
        applyOrgTheme({ primary_rgb: saved?.primary_rgb ?? null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [saved?.primary_rgb]);


  async function handlePickFile(file: File | null) {
    setPendingFile(null);

    if (!file) return;

    const maxBytes = 150 * 1024; // 150kb
    if (file.size > maxBytes) {
      showToast("Logo too large. Max 150 KB.");
      return;
    }

    const allowed = ["image/png", "image/jpeg", "image/svg+xml"];
    if (!allowed.includes(file.type)) {
      showToast("Invalid file type. Use PNG, JPG/JPEG, or SVG.");
      return;
    }

    setPendingFile(file);
    // If they pick a file, assume they intend to use it
    setUseDefaultLogo(false);
  }

  async function uploadLogoIfNeeded(): Promise<string | null> {
    if (!orgId) return null;
    if (!pendingFile) return logoPath;

    const ext =
      pendingFile.type === "image/png"
        ? "png"
        : pendingFile.type === "image/svg+xml"
        ? "svg"
        : "jpg";

    const path = `org/${orgId}/logo.${ext}`;

    const { error: upErr } = await supabase.storage
      .from("org-logos")
      .upload(path, pendingFile, {
        upsert: true,
        cacheControl: "3600",
        contentType: pendingFile.type,
      });

    if (upErr) {
      throw new Error(upErr.message);
    }

    return path;
  }

  async function saveAll() {
    if (!orgId) return;
    if (!canEdit) {
      showToast("You don’t have permission to edit org settings.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const triplet = hexToRgbTriplet(primaryHex);
      if (!triplet) {
        setSaving(false);
        showToast("Invalid primary color.");
        return;
      }

      const bannerBgTriplet = hexToRgbTriplet(bannerBgHex);
      const bannerTextTriplet = hexToRgbTriplet(bannerTextHex);

      if (!bannerBgTriplet || !bannerTextTriplet) {
        setSaving(false);
        showToast("Invalid banner colors.");
        return;
      }

      const uploadedPath = await uploadLogoIfNeeded();

      const next: SettingsRow = {
        logo_path: useDefaultLogo ? null : uploadedPath,
        use_default_logo: useDefaultLogo,
        primary_rgb: triplet,

        report_header_text: reportHeader.trim() ? reportHeader.trim() : null,
        report_subheader_text: reportSubheader.trim()
          ? reportSubheader.trim()
          : null,
        report_banner_bg_rgb: bannerBgTriplet,
        report_banner_text_rgb: bannerTextTriplet,
      };

    const { error: upErr } = await supabase
    .from("organization_settings")
    .update({
        logo_path: next.logo_path,
        use_default_logo: next.use_default_logo,
        primary_rgb: next.primary_rgb,
        report_header_text: next.report_header_text,
        report_subheader_text: next.report_subheader_text,
        report_banner_bg_rgb: next.report_banner_bg_rgb,
        report_banner_text_rgb: next.report_banner_text_rgb,
    })
    .eq("organization_id", orgId);

      setSaved(next);
      setLogoPath(next.logo_path);
      setPendingFile(null);

      showToast("Saved");
      setSaving(false);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save.";
      setError(msg);
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="p-10 text-slate-700">Loading…</div>;
  }

  if (!orgId) {
    return (
      <div className="p-10 text-slate-700">
        No active organization selected.
      </div>
    );
  }

  function resetToSaved() {
    if (!saved) return;

    setUseDefaultLogo(!!saved.use_default_logo);
    setLogoPath(saved.logo_path);
    setPendingFile(null);

    setPrimaryHex(rgbTripletToHex(saved.primary_rgb) ?? "#2f5e85");

    setReportHeader(saved.report_header_text ?? "");
    setReportSubheader(saved.report_subheader_text ?? "");

    setBannerBgHex(rgbTripletToHex(saved.report_banner_bg_rgb) ?? "#0f172a");
    setBannerTextHex(rgbTripletToHex(saved.report_banner_text_rgb) ?? "#ffffff");

    // re-apply theme from saved
    applyOrgTheme({ primary_rgb: saved.primary_rgb });
    }

  return (
    <>
      <Toast show={toastOpen} text={toastText} />

      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Organization</div>
            <div className="text-sm text-slate-600">
              Profile and preferences for this organization.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={saveAll}
              disabled={!canEdit || saving}
              className={`rounded-2xl px-4 py-2 text-sm font-semibold ${
                !canEdit || saving
                  ? "border bg-slate-100 text-slate-400"
                  : "bg-primary text-white hover:opacity-95"
              }`}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button
            className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
            onClick={() => {
                if (isDirty) resetToSaved();
                router.push("/app/settings");
            }}
            >
            Back to Settings
            </button>
          </div>
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-4xl space-y-4">
          {error ? (
            <div className="rounded-3xl border bg-white p-4 text-sm text-red-600">
              {error}
            </div>
          ) : null}

          {/* Info */}
          <div className="rounded-3xl border bg-white">
            <div className="border-b px-5 py-4">
              <div className="text-xl font-semibold">Organization info</div>
              <div className="mt-1 text-xs text-slate-600">
                Read-only details about this organization.
              </div>
            </div>

            <div className="px-5 py-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-semibold text-slate-600">
                    Registered name
                  </div>
                  <div className="mt-1 font-semibold">{org?.name ?? "—"}</div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-600">
                    Organization created
                  </div>
                  <div className="mt-1">
                    {org?.created_at ? fmtDate(org.created_at) : "—"}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Preferences */}
          <div className="rounded-3xl border bg-white">
            <div className="border-b px-5 py-4">
              <div className="text-xl font-semibold">Preferences</div>
              <div className="mt-1 text-xs text-slate-600">
                Only owners/admins can change these.
              </div>
            </div>

            <div className="divide-y">
              {/* Logo */}
              <div className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">Logo</div>
                    <div className="mt-1 text-sm text-slate-600">
                      PNG, JPG/JPEG, or SVG. Max 100 KB.
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-2xl overflow-hidden bg-slate-100 flex items-center justify-center">
                    {useDefaultLogo || !logoUrl ? (
                      <BrandLogo size={28} />
                    ) : (
                      <Image
                        src={logoUrl}
                        alt={org?.name ?? "Organization logo"}
                        width={48}
                        height={48}
                        className="object-contain"
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={useDefaultLogo}
                        onChange={(e) => setUseDefaultLogo(e.target.checked)}
                        disabled={!canEdit}
                      />
                      Use default logo
                    </label>

                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/svg+xml"
                      disabled={!canEdit}
                      onChange={(e) =>
                        handlePickFile(e.target.files?.[0] ?? null)
                      }
                      className="text-sm"
                    />

                    {pendingFile ? (
                      <div className="text-xs text-slate-600">
                        Selected:{" "}
                        <span className="font-semibold">
                          {pendingFile.name}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Primary color */}
              <div className="px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-lg font-semibold">Primary color</div>
                    <div className="mt-1 text-sm text-slate-600">
                      This controls the app&apos;s primary brand color.
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-4">
                  <input
                    type="color"
                    value={primaryHex}
                    onChange={(e) => setPrimaryHex(e.target.value)}
                    disabled={!canEdit}
                    className="h-10 w-14 rounded-xl border bg-white p-1"
                  />

                  <div className="text-sm text-slate-700">
                    <div className="text-xs text-slate-500">Value</div>
                    <div className="font-semibold">
                      {primaryHex.toUpperCase()}
                    </div>
                    {saved?.primary_rgb ? (
                      <div className="mt-1 text-xs text-slate-500">
                        Saved: {saved.primary_rgb}
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-slate-500">
                        Saved: (default)
                      </div>
                    )}
                  </div>

                  <div className="ml-auto">
                    <div className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white">
                      Preview
                    </div>
                  </div>
                </div>
              </div>

              {/* Report header */}
                <div className="px-5 py-4">
                <div className="text-lg font-semibold">Report header</div>
                <div className="mt-1 text-sm text-slate-600">
                    If header text is blank, reports can default to the organization name.
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div>
                    <div className="text-xs font-semibold text-slate-600">Header text</div>
                    <input
                        value={reportHeader}
                        onChange={(e) => setReportHeader(e.target.value)}
                        disabled={!canEdit}
                        placeholder={org?.name ?? "Organization name"}
                        className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    />
                    </div>

                    <div>
                    <div className="text-xs font-semibold text-slate-600">Subheader (optional)</div>
                    <input
                        value={reportSubheader}
                        onChange={(e) => setReportSubheader(e.target.value)}
                        disabled={!canEdit}
                        placeholder="e.g. Financial report, prepared for leadership"
                        className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    />
                    </div>
                </div>
                </div>

                {/* Report banner colors */}
                <div className="px-5 py-4">
                <div className="text-lg font-semibold">Report banner colors</div>
                <div className="mt-1 text-sm text-slate-600">
                    Controls the report header block background and text color.
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-3">
                    <div className="text-xs font-semibold text-slate-600">Background</div>
                    <input
                        type="color"
                        value={bannerBgHex}
                        onChange={(e) => setBannerBgHex(e.target.value)}
                        disabled={!canEdit}
                        className="h-10 w-14 rounded-xl border bg-white p-1"
                    />
                    <div className="text-sm font-semibold text-slate-700">{bannerBgHex.toUpperCase()}</div>
                    </div>

                    <div className="flex items-center gap-3">
                    <div className="text-xs font-semibold text-slate-600">Text</div>
                    <input
                        type="color"
                        value={bannerTextHex}
                        onChange={(e) => setBannerTextHex(e.target.value)}
                        disabled={!canEdit}
                        className="h-10 w-14 rounded-xl border bg-white p-1"
                    />
                    <div className="text-sm font-semibold text-slate-700">{bannerTextHex.toUpperCase()}</div>
                    </div>

                    {/* Mini preview */}
                    <div
                    className="ml-auto rounded-2xl px-4 py-3 text-sm font-semibold"
                    style={{
                        backgroundColor: `rgb(${hexToRgbTriplet(bannerBgHex) ?? "15 23 42"})`,
                        color: `rgb(${hexToRgbTriplet(bannerTextHex) ?? "255 255 255"})`,
                    }}
                    >
                    {reportHeader.trim() || org?.name || "Report header"}
                    {reportSubheader.trim() ? (
                        <div className="text-xs font-normal opacity-90">{reportSubheader.trim()}</div>
                    ) : null}
                    </div>
                </div>
                </div>
            </div>

            {!canEdit ? (
              <div className="border-t px-5 py-3 text-xs text-slate-500">
                You can view these settings, but only organization owners/admins
                can edit them.
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </>
  );
}
