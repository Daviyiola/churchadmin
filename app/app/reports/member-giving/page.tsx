"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";
import { buildMemberGivingPrintUrl } from "@/lib/reports/members/printUrl";

import type {
  PaymentMethod,
  MemberGivingMode,
} from "@/lib/reports/members/types";

type CategoryType = "income" | "services";
type Cat = { id: string; name: string; type: CategoryType };
type Option = { id: string; name: string };
type MemberOption = Option & { status: "active" | "archived" };

type MemberRow = {
  id: string;
  first_name: string;
  last_name: string;
  status: "active" | "archived";
};

type Role = "owner" | "admin" | "finance" | "viewer" | "member";

async function getMyRoleForOrg(orgId: string): Promise<Role | null> {
  const { data: sessionRes } = await supabase.auth.getSession();
  const userId = sessionRes.session?.user?.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return null;
  return (data?.role as Role) ?? null;
}

async function fetchCategories(
  orgId: string,
  type: CategoryType,
): Promise<Cat[]> {
  const { data, error } = await supabase
    .from("categories")
    .select("id,name,type,status")
    .eq("org_id", orgId)
    .eq("status", "active")
    .eq("type", type)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as Cat[];
}

async function fetchMembers(orgId: string): Promise<MemberRow[]> {
  const { data, error } = await supabase
    .from("members")
    .select("id,first_name,last_name,status")
    .eq("org_id", orgId)
    .in("status", ["active", "archived"])
    .order("last_name", { ascending: true })
    .order("first_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as MemberRow[];
}

const METHOD_OPTIONS: { id: PaymentMethod; name: string }[] = [
  { id: "cash", name: "Cash" },
  { id: "cheque", name: "Cheque" },
  { id: "online", name: "Online" },
];

export default function MemberGivingPage() {
  const router = useRouter();

  const today = useMemo(() => new Date(), []);
  const defaultStart = useMemo(() => {
    const d = new Date(today);
    d.setDate(1);
    return toYmd(d);
  }, [today]);
  const defaultEnd = useMemo(() => toYmd(today), [today]);

  const [orgId, setOrgId] = useState<string>("");

  const [mode, setMode] = useState<MemberGivingMode>("summary");

  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);

  // member
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [memberOptions, setMemberOptions] = useState<MemberOption[]>([]);

  // filters
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);

  // options
  const [serviceOptions, setServiceOptions] = useState<Option[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<Option[]>([]);

  const [loadErr, setLoadErr] = useState("");

  const [memberQuery, setMemberQuery] = useState("");
  const [memberOpen, setMemberOpen] = useState(false);
  const [archivedMembersOpen, setArchivedMembersOpen] = useState(false);

  const [authChecked, setAuthChecked] = useState(false);
  const [isAllowed, setIsAllowed] = useState(false);

  const selectedMemberName = useMemo(() => {
    return memberOptions.find((m) => m.id === memberIds[0])?.name ?? "";
  }, [memberOptions, memberIds]);

  const activeMemberOptions = useMemo(
    () => memberOptions.filter((member) => member.status === "active"),
    [memberOptions],
  );

  const archivedMemberOptions = useMemo(
    () => memberOptions.filter((member) => member.status === "archived"),
    [memberOptions],
  );

  const filteredMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return activeMemberOptions.slice(0, 30);
    return activeMemberOptions
      .filter((m) => m.name.toLowerCase().includes(q))
      .slice(0, 30);
  }, [activeMemberOptions, memberQuery]);

  const filteredArchivedMembers = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return archivedMemberOptions;
    return archivedMemberOptions.filter((member) =>
      member.name.toLowerCase().includes(q),
    );
  }, [archivedMemberOptions, memberQuery]);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoadErr("");

        const oid = getActiveOrgId();
        if (!oid) throw new Error("No active organization selected.");
        if (!alive) return;

        // --- AUTH GATE ---
        const role = await getMyRoleForOrg(oid);
        const allowed = role === "owner" || role === "admin";

        if (!alive) return;
        setIsAllowed(allowed);
        setAuthChecked(true);

        if (!allowed) {
          router.replace("/app/reports");
          return;
        }

        // --- NORMAL LOAD ---
        setOrgId(oid);

        const [members, svcs, incCats] = await Promise.all([
          fetchMembers(oid),
          fetchCategories(oid, "services"),
          fetchCategories(oid, "income"),
        ]);

        if (!alive) return;

        const memOpts: MemberOption[] = members.map((m) => ({
          id: m.id,
          name: `${m.last_name}, ${m.first_name}`.trim(),
          status: m.status,
        }));

        const svcOpts: Option[] = svcs.map((x) => ({ id: x.id, name: x.name }));
        const catOpts: Option[] = incCats.map((x) => ({
          id: x.id,
          name: x.name,
        }));

        setMemberOptions(memOpts);
        setServiceOptions(svcOpts);
        setCategoryOptions(catOpts);

        const firstActive = memOpts.find((member) => member.status === "active");
        if (!memberIds.length && firstActive) setMemberIds([firstActive.id]);

        setServiceIds(svcOpts.map((x) => x.id));
        setCategoryIds(catOpts.map((x) => x.id));
        setMethods(METHOD_OPTIONS.map((m) => m.id));
      } catch (e: unknown) {
        if (!alive) return;
        setAuthChecked(true);
        setLoadErr(e instanceof Error ? e.message : "Failed to load filters.");
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openPrintView() {
    if (!orgId) return alert("No active organization selected.");
    if (!memberIds.length) return alert("Please select at least one member.");
    if (mode !== "monthly" && memberIds.length !== 1)
      return alert("Summary and detailed reports require exactly one member.");
    if (!start || !end) return alert("Please select a start and end date.");
    if (end < start)
      return alert("End date cannot be earlier than start date.");

    const url = buildMemberGivingPrintUrl({
      org: orgId,
      member_id: mode === "monthly" ? undefined : memberIds[0],
      member_ids: mode === "monthly" ? memberIds : undefined,
      mode,
      start,
      end,
      category_ids: categoryIds.length ? categoryIds : undefined,
      service_ids: serviceIds.length ? serviceIds : undefined,
      payment_methods: methods.length ? methods : undefined,
    });

    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <>
      {authChecked && !isAllowed ? (
        <div className="p-6">
          <div className="max-w-2xl">
            <div className="rounded-3xl border bg-white p-6">
              <div className="text-lg font-semibold">Member giving report</div>
              <div className="mt-2 text-sm text-slate-600">
                This report is available to{" "}
                <span className="font-semibold">Admins/Owners</span> only. Ask
                an admin to grant you access.
              </div>

              <div className="mt-5 flex items-center gap-3">
                <button
                  onClick={() => router.push("/app/reports")}
                  className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold"
                  type="button"
                  title="Back to Reports"
                >
                  Back to Reports
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Member giving report</div>
            <div className="text-sm text-slate-600">
              Select members, set filters, then open the print view.
            </div>
          </div>

          <button
            onClick={() => router.push("/app/reports")}
            className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black border"
            type="button"
          >
            Back to Reports
          </button>
        </div>
      </div>

      <div className="p-6">
        <div className="max-w-7xl">
          <div className="rounded-3xl border bg-white">
            <div className="border-b px-5 py-4">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-xl font-semibold">FILTERS</div>
                  <div className="mt-1 text-sm text-slate-600">
                    Filters apply to the selected member’s giving totals.
                  </div>
                </div>

                <div className="flex items-center gap-3 text-sm text-slate-900">
                  <span className="font-semibold">Date range</span>

                  <input
                    type="date"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="rounded-lg border px-4 py-2 text-xs outline-none focus:border-slate-400"
                  />

                  <span className="text-slate-800">to</span>

                  <input
                    type="date"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="rounded-lg border px-4 py-2 text-xs outline-none focus:border-slate-400"
                  />
                </div>
              </div>
            </div>

            <div className="p-5">
              {loadErr ? (
                <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  {loadErr}
                </div>
              ) : null}

              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                {/* Member — explicitly grows */}
                <div className="w-full min-w-0 lg:flex-[3]">
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    {mode === "monthly" ? "Members" : "Member"}
                  </div>

                  {mode === "monthly" ? (
                    <MonthlyMemberSelector
                      query={memberQuery}
                      onQueryChange={(value) => {
                        setMemberQuery(value);
                        setArchivedMembersOpen(false);
                      }}
                      activeMembers={filteredMembers}
                      allActiveMembers={activeMemberOptions}
                      archivedMembers={filteredArchivedMembers}
                      archivedOpen={archivedMembersOpen}
                      onArchivedOpenChange={setArchivedMembersOpen}
                      selected={memberIds}
                      onSelectedChange={setMemberIds}
                    />
                  ) : (
                  <div className="relative">
                    <input
                      value={memberOpen ? memberQuery : selectedMemberName}
                      onChange={(e) => {
                        setMemberQuery(e.target.value);
                        setMemberOpen(true);
                        setArchivedMembersOpen(false);
                      }}
                      onFocus={() => {
                        // auto-clear when cursor enters
                        setMemberQuery("");
                        setMemberOpen(true);
                        setArchivedMembersOpen(false);
                      }}
                      onBlur={() => {
                        // close after click selection has a moment to register
                        setTimeout(() => setMemberOpen(false), 120);
                      }}
                      placeholder="Search members..."
                      className="w-full rounded-lg border px-4 py-2 text-sm outline-none focus:border-slate-400"
                    />

                    {memberOpen && (
                      <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-2xl border bg-white shadow-lg">
                        <div className="max-h-64 overflow-auto">
                          {filteredMembers.length === 0 ? (
                            <div className="px-4 py-3 text-sm text-slate-500">
                              No active matches
                            </div>
                          ) : (
                            filteredMembers.map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()} // prevent blur before click
                                onClick={() => {
                                  setMemberIds([m.id]);
                                  setMemberOpen(false);
                                  setMemberQuery("");
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-slate-800 hover:bg-slate-50"
                              >
                                {m.name}
                              </button>
                            ))
                          )}
                          {filteredArchivedMembers.length ? (
                            <div className="border-t">
                              <button
                                type="button"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => setArchivedMembersOpen((open) => !open)}
                                className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-semibold text-slate-600 hover:bg-slate-50"
                              >
                                <span>
                                  {filteredArchivedMembers.length} archived {filteredArchivedMembers.length === 1 ? "member" : "members"} found
                                </span>
                                <span>{archivedMembersOpen ? "Hide" : "Show"}</span>
                              </button>
                              {archivedMembersOpen
                                ? filteredArchivedMembers.map((member) => (
                                    <button
                                      key={member.id}
                                      type="button"
                                      onMouseDown={(event) => event.preventDefault()}
                                      onClick={() => {
                                        setMemberIds([member.id]);
                                        setMemberOpen(false);
                                        setArchivedMembersOpen(false);
                                        setMemberQuery("");
                                      }}
                                      className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                                    >
                                      <span>{member.name}</span>
                                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                                        Archived
                                      </span>
                                    </button>
                                  ))
                                : null}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                  )}
                </div>

                {/* Report type — constrained */}
                <div className="w-full min-w-0 lg:w-[220px] lg:flex-none">
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Report type
                  </div>
                  <select
                    value={mode}
                    onChange={(e) => {
                      const nextMode = e.target.value as MemberGivingMode;
                      setMode(nextMode);
                      if (nextMode !== "monthly" && memberIds.length > 1) {
                        setMemberIds(memberIds.slice(0, 1));
                      }
                    }}
                    className="w-full rounded-lg border px-4 py-2 text-sm outline-none focus:border-slate-400"
                  >
                    <option value="summary">Summary</option>
                    <option value="detailed">Detailed</option>
                    <option value="monthly">Monthly by member</option>
                  </select>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
                <Card title="Services">
                  <CheckList
                    options={serviceOptions}
                    selected={serviceIds}
                    onToggle={(id) => setServiceIds(toggleId(serviceIds, id))}
                    onSelectAll={() =>
                      setServiceIds(serviceOptions.map((x) => x.id))
                    }
                    onClear={() => setServiceIds([])}
                    emptyText="No services yet."
                  />
                </Card>

                <Card title="Income categories">
                  <CheckList
                    options={categoryOptions}
                    selected={categoryIds}
                    onToggle={(id) => setCategoryIds(toggleId(categoryIds, id))}
                    onSelectAll={() =>
                      setCategoryIds(categoryOptions.map((x) => x.id))
                    }
                    onClear={() => setCategoryIds([])}
                    emptyText="No categories yet."
                  />
                </Card>

                <Card title="Payment methods">
                  <CheckList<PaymentMethod>
                    options={METHOD_OPTIONS}
                    selected={methods}
                    onToggle={(id) => setMethods(toggleId(methods, id))}
                    onSelectAll={() =>
                      setMethods(METHOD_OPTIONS.map((x) => x.id))
                    }
                    onClear={() => setMethods([])}
                    emptyText="No payment methods."
                  />
                </Card>
              </div>

              <div className="mt-5">
                <button
                  onClick={openPrintView}
                  className="w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:opacity-90"
                  type="button"
                >
                  Open print view
                </button>

                <div className="mt-2 text-xs text-slate-500">
                  Tip: Leaving a checklist empty means “all”.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function MonthlyMemberSelector({
  query,
  onQueryChange,
  activeMembers,
  allActiveMembers,
  archivedMembers,
  archivedOpen,
  onArchivedOpenChange,
  selected,
  onSelectedChange,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  activeMembers: MemberOption[];
  allActiveMembers: MemberOption[];
  archivedMembers: MemberOption[];
  archivedOpen: boolean;
  onArchivedOpenChange: (open: boolean) => void;
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
}) {
  return (
    <div className="rounded-2xl border bg-white">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search members..."
          className="min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        <button
          type="button"
          className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50"
          onClick={() => onSelectedChange(allActiveMembers.map((member) => member.id))}
        >
          Select all active
        </button>
        <button
          type="button"
          className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50"
          onClick={() => onSelectedChange([])}
        >
          Clear
        </button>
      </div>
      <div className="px-3 py-2 text-xs font-semibold text-slate-600">
        {selected.length} selected
      </div>
      <div className="max-h-64 overflow-auto border-t">
        {activeMembers.length ? (
          activeMembers.map((member) => (
            <MemberCheckRow
              key={member.id}
              member={member}
              selected={selected.includes(member.id)}
              onToggle={() => onSelectedChange(toggleId(selected, member.id))}
            />
          ))
        ) : (
          <div className="px-3 py-3 text-sm text-slate-500">
            No active members found.
          </div>
        )}
        {archivedMembers.length ? (
          <div className="border-t">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-slate-600 hover:bg-slate-50"
              onClick={() => onArchivedOpenChange(!archivedOpen)}
            >
              <span>
                {archivedMembers.length} archived {archivedMembers.length === 1 ? "member" : "members"}
              </span>
              <span>{archivedOpen ? "Hide" : "Show"}</span>
            </button>
            {archivedOpen
              ? archivedMembers.map((member) => (
                  <MemberCheckRow
                    key={member.id}
                    member={member}
                    selected={selected.includes(member.id)}
                    onToggle={() => onSelectedChange(toggleId(selected, member.id))}
                    archived
                  />
                ))
              : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MemberCheckRow({
  member,
  selected,
  onToggle,
  archived = false,
}: {
  member: MemberOption;
  selected: boolean;
  onToggle: () => void;
  archived?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 hover:bg-slate-50">
      <span className="flex min-w-0 items-center gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-4 w-4 accent-slate-900"
        />
        <span className="truncate text-sm text-slate-800">{member.name}</span>
      </span>
      {archived ? (
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          Archived
        </span>
      ) : null}
    </label>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-3xl border bg-white p-4">
      <div className="text-xs font-semibold text-slate-600">{title}</div>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function CheckList<TId extends string>({
  options,
  selected,
  onToggle,
  onSelectAll,
  onClear,
  emptyText,
}: {
  options: { id: TId; name: string }[];
  selected: TId[];
  onToggle: (id: TId) => void;
  onSelectAll: () => void;
  onClear: () => void;
  emptyText: string;
}) {
  return (
    <div className="rounded-2xl border">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="text-xs font-semibold text-slate-600">
          {selected.length} selected
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSelectAll}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            type="button"
          >
            Select all
          </button>
          <span className="text-slate-300">|</span>
          <button
            onClick={onClear}
            className="text-xs font-semibold text-slate-600 hover:text-slate-900"
            type="button"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="max-h-64 overflow-auto border-t">
        {options.length === 0 ? (
          <div className="px-3 py-3 text-sm text-slate-500">{emptyText}</div>
        ) : (
          options.map((o) => {
            const isOn = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={isOn}
                  onChange={() => onToggle(o.id)}
                  className="h-4 w-4 accent-slate-900"
                />
                <span className="text-sm text-slate-800">{o.name}</span>
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

function toggleId<T extends string>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function toYmd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
