"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAccessToken, getActiveOrgRole } from "@/lib/auth";
import type { PlanKey } from "@/lib/plans";
import {
  friendlyTimezoneName,
  timezoneOptions,
} from "@/lib/timezones";
import NikkyInfoModal from "@/components/nikky/NikkyInfoModal";

type SettingsResponse = {
  settings: {
    timezone_name: string | null;
    timezone_confirmed: boolean;
    nikky_enabled: boolean;
  };
  plan: PlanKey;
  usage: {
    month: string;
    percentage: number;
    warning_level: "normal" | "warning" | "critical" | "paused";
    request_count: number;
  };
  custom_cap_configured: boolean;
  openai_configured: boolean;
  signing_configured: boolean;
};

async function call(init?: RequestInit) {
  const token = await getAccessToken();
  const response = await fetch("/api/nikky/settings", {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data as SettingsResponse;
}

export default function NikkySettingsPage() {
  const router = useRouter();
  const role = getActiveOrgRole();
  const canEdit = role === "owner" || role === "admin";
  const timezones = useMemo(() => timezoneOptions(), []);

  const [timezone, setTimezone] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [plan, setPlan] = useState<PlanKey>("basic");
  const [percentage, setPercentage] = useState(0);
  const [warningLevel, setWarningLevel] =
    useState<SettingsResponse["usage"]["warning_level"]>("normal");
  const [requestCount, setRequestCount] = useState(0);
  const [customCapConfigured, setCustomCapConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    call()
      .then((data) => {
        setTimezone(data.settings.timezone_name ?? "");
        setEnabled(data.settings.nikky_enabled);
        setPlan(data.plan);
        setPercentage(data.usage.percentage);
        setWarningLevel(data.usage.warning_level);
        setRequestCount(data.usage.request_count);
        setCustomCapConfigured(data.custom_cap_configured);
      })
      .catch((error) =>
        setMessage(
          error instanceof Error ? error.message : "Unable to load settings.",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const data = await call({
        method: "PUT",
        body: JSON.stringify({
          nikky_enabled: enabled,
          timezone_name: timezone || null,
        }),
      });
      setTimezone(data.settings.timezone_name ?? "");
      setEnabled(data.settings.nikky_enabled);
      setMessage(
        "Nikky settings saved. The organization timezone is now synchronized.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="p-6">Loading…</div>;

  const barColor =
    warningLevel === "paused"
      ? "bg-red-600"
      : warningLevel === "critical"
        ? "bg-orange-500"
        : warningLevel === "warning"
          ? "bg-amber-500"
          : "bg-primary";

  return (
    <>
      <div className="border-b px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Nikky settings</h1>
            <p className="text-sm text-slate-600">
              Organization access and monthly allowance usage.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:border-primary hover:bg-slate-50"
          >
            What is Nikky?
          </button>
        </div>
      </div>

      <div className="max-w-3xl space-y-4 p-6">
        {message ? (
          <div className="rounded-2xl border bg-white p-3 text-sm">
            {message}
          </div>
        ) : null}

        {!canEdit ? (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            You can review these settings. Only an organization owner or admin
            can change the timezone or enable Nikky.
          </div>
        ) : null}

        <div className="rounded-3xl border bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-sm text-slate-500">Current plan</div>
              <div className="mt-1 text-xl font-semibold capitalize">
                {plan}
              </div>
            </div>
            <div
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                warningLevel === "paused"
                  ? "bg-red-100 text-red-700"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {warningLevel === "paused"
                ? "Nikky paused"
                : "Monthly allowance"}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span>
                {percentage}% of this month&apos;s Nikky allowance used
              </span>
              <span className="shrink-0 text-slate-500">
                {requestCount} requests
              </span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all ${barColor}`}
                style={{ width: `${Math.min(100, percentage)}%` }}
              />
            </div>
          </div>

          <p className="mt-3 text-xs text-slate-500">
            The allowance is Church Admin&apos;s internal AI-usage limit. It
            resets monthly, does not roll over, and never affects normal Church
            Admin features.
          </p>
          {warningLevel === "warning" ? (
            <p className="mt-3 text-sm text-amber-700">
              This organization has used at least 70% of its monthly Nikky
              allowance.
            </p>
          ) : null}
          {warningLevel === "critical" ? (
            <p className="mt-3 text-sm text-orange-700">
              This organization has used at least 90% of its monthly Nikky
              allowance.
            </p>
          ) : null}
          {warningLevel === "paused" ? (
            <p className="mt-3 text-sm text-red-700">
              Nikky is paused until the monthly allowance resets. Other Church
              Admin features continue normally.
            </p>
          ) : null}
          {plan === "enterprise" && !customCapConfigured ? (
            <p className="mt-3 text-sm text-amber-700">
              The negotiated Enterprise allowance still needs to be configured
              by Church Admin.
            </p>
          ) : null}
        </div>

        <div className="rounded-3xl border bg-white p-5">
          <label className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Organization timezone
            </span>
            <select
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              disabled={!canEdit || saving}
              className="mt-2 w-full rounded-2xl border bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-100"
            >
              <option value="">Select a timezone</option>
              {timezones.map((value) => (
                <option key={value} value={value}>
                  {friendlyTimezoneName(value)}
                </option>
              ))}
            </select>
            <span className="mt-2 block text-xs leading-5 text-slate-500">
              Nikky uses this shared organization timezone to resolve phrases
              such as today, this month, and this year. Changes here also appear
              in Organization Settings.
            </span>
          </label>

          <label className="mt-5 flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canEdit || saving}
              onChange={(event) => setEnabled(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">
                Enable Nikky for this organization
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">
                Nikky is available only to owner, admin, and finance roles.
              </span>
            </span>
          </label>

          <div className="mt-5 flex flex-wrap gap-2">
            {canEdit ? (
              <button
                disabled={saving}
                onClick={save}
                className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save settings"}
              </button>
            ) : null}
            <button
              onClick={() => router.push("/app/settings/org")}
              className="rounded-2xl border px-4 py-2 text-sm"
            >
              Organization settings
            </button>
            <button
              onClick={() => router.push("/app/settings")}
              className="rounded-2xl border px-4 py-2 text-sm"
            >
              Back
            </button>
          </div>
        </div>
      </div>

      <NikkyInfoModal open={infoOpen} onClose={() => setInfoOpen(false)} />
    </>
  );
}
