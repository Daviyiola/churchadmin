"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";

type CategoryType = "income" | "expense" | "services";
type CategoryStatus = "active" | "archived";

type CategoryRow = {
  id: string;
  org_id: string;
  name: string;
  type: CategoryType;
  status: CategoryStatus;
  created_by: string;
  created_at: string;
};

async function isAdminForActiveOrg(orgId: string): Promise<boolean> {
  const { data: sessionRes } = await supabase.auth.getSession();
  const userId = sessionRes.session?.user?.id;
  if (!userId) return false;

  const { data, error } = await supabase
    .from("user_organizations")
    .select("role")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) return false;
  return data?.role === "admin" || data?.role === "owner";
}

function fmtDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function typeLabel(t: CategoryType) {
  if (t === "income") return "Income";
  if (t === "expense") return "Expense";
  return "Services";
}

function normalizeName(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "green" | "amber";
}) {
  const cls =
    tone === "green"
      ? "border-green-200 bg-green-50 text-green-700"
      : tone === "amber"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-slate-200 bg-slate-50 text-slate-700";

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

function isPostgresUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export default function CategoriesPage() {
  const orgId = getActiveOrgId();

  const [tab, setTab] = useState<CategoryStatus>("active");
  const [typeFilter, setTypeFilter] = useState<"" | CategoryType>("");
  const [q, setQ] = useState("");

  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [isAdmin, setIsAdmin] = useState(false);

  // modal
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [catType, setCatType] = useState<CategoryType>("income");
  const [saving, setSaving] = useState(false);
  const [formErr, setFormErr] = useState("");

  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editId, setEditId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (typeFilter && r.type !== typeFilter) return false;
      if (!needle) return true;
      const n = r.name.toLowerCase();
      return n.includes(needle);
    });
  }, [rows, q, typeFilter]);

  const load = async () => {
    if (!orgId) return;

    setLoading(true);
    setErr("");

    const [adminFlag] = await Promise.all([isAdminForActiveOrg(orgId)]);
    setIsAdmin(adminFlag);

    const { data, error } = await supabase
      .from("categories")
      .select("id,org_id,name,type,status,created_by,created_at")
      .eq("org_id", orgId)
      .eq("status", tab)
      .order("created_at", { ascending: false });

    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
      setRows((data || []) as CategoryRow[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, tab]);

  const openCreate = () => {
    setMode("create");
    setEditId(null);
    setName("");
    setCatType("income");
    setFormErr("");
    setErr("");
    setOpen(true);
  };

  const openEdit = (c: CategoryRow) => {
    setMode("edit");
    setEditId(c.id);
    setName(c.name);
    setCatType(c.type);
    setFormErr("");
    setErr("");
    setOpen(true);
  };

  const closeModal = () => {
    setOpen(false);
    setMode("create");
    setEditId(null);
    setName("");
    setCatType("income");
    setFormErr("");
  };

  const updateCategory = async () => {
    if (!orgId) return;

    setFormErr("");
    setErr("");

    if (!isAdmin) {
      setFormErr("Only admins can edit categories.");
      return;
    }

    const cleanName = name.trim();
    if (!cleanName) {
      setFormErr("Name is required.");
      return;
    }
    if (!editId) {
      setFormErr("Missing category id.");
      return;
    }

    const nameNorm = normalizeName(cleanName);

    // soft pre-check for duplicates (excluding self)
    const { data: exists, error: existsErr } = await supabase
      .from("categories")
      .select("id")
      .eq("org_id", orgId)
      .eq("type", catType)
      .eq("name_norm", nameNorm)
      .neq("id", editId)
      .maybeSingle();

    if (existsErr) {
      setFormErr(existsErr.message);
      return;
    }

    if (exists?.id) {
      setFormErr(
        `A ${typeLabel(catType)} category named "${cleanName}" already exists.`
      );
      return;
    }

    setSaving(true);

    const { error } = await supabase
      .from("categories")
      .update({
        name: cleanName,
        type: catType,
        // updated_at is handled by trigger, but ok to leave it out
      })
      .eq("id", editId);

    if (error) {
      if (isPostgresUniqueViolation(error)) {
        setFormErr(
          `A ${typeLabel(
            catType
          )} category named "${cleanName}" already exists.`
        );
      } else {
        setFormErr(error.message);
      }
      setSaving(false);
      return;
    }

    setSaving(false);
    closeModal();
    await load();
  };

  const deleteCategory = async (id: string) => {
    if (!isAdmin) {
      setErr("Only admins can delete categories.");
      return;
    }
    setErr("");
    const ok = confirm("Delete this category? This cannot be undone.");
    if (!ok) return;

    const { error } = await supabase.from("categories").delete().eq("id", id);
    if (error) setErr(error.message);
    else await load();
  };

  const canSave = name.trim().length > 0 && !saving;

  const saveCategory = async () => {
    if (!orgId) return;

    setFormErr("");
    setErr("");

    const cleanName = name.trim();
    if (!cleanName) {
      setFormErr("Name is required.");
      return;
    }

    const { data: sessionRes } = await supabase.auth.getSession();
    const userId = sessionRes.session?.user?.id;
    if (!userId) {
      setFormErr("You must be signed in.");
      return;
    }

    const nameNorm = normalizeName(cleanName);

    // soft pre-check (nice UX). Still rely on DB unique constraint as truth.
    const { data: exists } = await supabase
      .from("categories")
      .select("id")
      .eq("org_id", orgId)
      .eq("type", catType)
      .eq("name_norm", nameNorm)
      .maybeSingle();

    if (exists?.id) {
      setFormErr(
        `A ${typeLabel(catType)} category named "${cleanName}" already exists.`
      );
      return;
    }

    setSaving(true);

    const { error } = await supabase.from("categories").insert({
      org_id: orgId,
      name: cleanName,
      type: catType,
      status: "active",
      created_by: userId,
    });

    if (error) {
      if (isPostgresUniqueViolation(error)) {
        setFormErr(
          `A ${typeLabel(
            catType
          )} category named "${cleanName}" already exists.`
        );
      } else {
        setFormErr(error.message);
      }
      setSaving(false);
      return;
    }

    setSaving(false);
    closeModal();
    await load();
  };

  const setStatus = async (id: string, next: CategoryStatus) => {
    if (!isAdmin) {
      setErr("Only admins can archive/restore categories.");
      return;
    }
    setErr("");

    const { error } = await supabase
      .from("categories")
      .update({ status: next })
      .eq("id", id);

    if (error) setErr(error.message);
    else await load();
  };

  return (
    <>
      {/* Top bar */}
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Categories</div>
            <div className="text-sm text-slate-600">
              Income • Expense • Services categories
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/85"
              onClick={openCreate}
            >
              Add category
            </button>
          </div>
        </div>

        {/* Controls row */}
        <div className="px-6 pb-5">
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-2xl border bg-slate-50 p-1">
              <button
                className={`rounded-2xl px-4 py-2 text-sm ${
                  tab === "active"
                    ? "bg-white border shadow-sm"
                    : "text-slate-600 hover:bg-white"
                }`}
                onClick={() => setTab("active")}
              >
                Active
              </button>
              <button
                className={`rounded-2xl px-4 py-2 text-sm ${
                  tab === "archived"
                    ? "bg-white border shadow-sm"
                    : "text-slate-600 hover:bg-white"
                }`}
                onClick={() => setTab("archived")}
              >
                Archived
              </button>
            </div>

            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
              <select
                className="w-full sm:w-44 rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                value={typeFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  if (
                    v === "" ||
                    v === "income" ||
                    v === "expense" ||
                    v === "services"
                  ) {
                    setTypeFilter(v);
                  }
                }}
              >
                <option value="">All types</option>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
                <option value="services">Services</option>
              </select>

              <input
                className="w-full sm:w-80 rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                placeholder="Search categories…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>

          {err ? (
            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {err}
            </div>
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="p-6">
        <div className="rounded-3xl border bg-white overflow-hidden">
          <div className="overflow-x-auto">
            {/* responsive horizontal scroll container */}
            <div className="min-w-[900px]">
              <div className="grid grid-cols-12 border-b bg-primary px-5 py-4 text-sm font-semibold text-slate-100 rounded-t-3xl">
                <div className="col-span-6">Name</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-3">Created</div>
                <div className="col-span-1 text-right">Actions</div>
              </div>

              {loading ? (
                <div className="p-6 text-sm text-slate-600">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-sm text-slate-600">
                  {q.trim()
                    ? "No categories match your search."
                    : tab === "active"
                    ? "No active categories yet."
                    : "No archived categories."}
                </div>
              ) : (
                <div className="divide-y">
                  {filtered.map((c) => (
                    <div
                      key={c.id}
                      className="grid grid-cols-12 items-center px-5 py-4 text-sm"
                    >
                      <div className="col-span-6">
                        <div className="font-semibold">{c.name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {c.status}
                        </div>
                      </div>

                      <div className="col-span-2">
                        <Pill tone="slate">{typeLabel(c.type)}</Pill>
                      </div>

                      <div className="col-span-3 text-slate-700">
                        {fmtDate(c.created_at)}
                      </div>

                      <div className="col-span-1 flex justify-end">
                        {isAdmin ? (
                          <div className="flex items-center gap-2">
                            <button
                              className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                              onClick={() => openEdit(c)}
                            >
                              Edit
                            </button>

                            {c.status === "active" ? (
                              <button
                                className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                                onClick={() => setStatus(c.id, "archived")}
                              >
                                Archive
                              </button>
                            ) : (
                              <button
                                className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                                onClick={() => setStatus(c.id, "active")}
                              >
                                Restore
                              </button>
                            )}

                            <button
                              className="rounded-xl border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                              onClick={() => deleteCategory(c.id)}
                            >
                              Delete
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 text-xs text-slate-500">
          Anyone can add categories. Only admins can archive/restore.
        </div>
      </div>

      {/* Create modal */}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white shadow-xl">
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">
                {mode === "create" ? "Add category" : "Edit category"}
              </div>
              <div className="text-xs text-slate-600">
                {mode === "create"
                  ? "Anyone can add a category."
                  : isAdmin
                  ? "Admin-only edit."
                  : "Admin-only edit."}
              </div>
            </div>

            <div className="px-6 py-6 space-y-4">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Name *
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setFormErr("");
                  }}
                  placeholder="e.g., Tithe, Offering, Rent, Sunday Service…"
                  autoFocus
                />
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Type *
                </div>
                <select
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={catType}
                  onChange={(e) => {
                    setCatType(e.target.value as CategoryType);
                    setFormErr("");
                  }}
                >
                  <option value="income">Income</option>
                  <option value="expense">Expense</option>
                  <option value="services">Services</option>
                </select>
              </div>

              {formErr ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {formErr}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={closeModal}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  !canSave ? "bg-slate-300" : "bg-primary hover:bg-primary/85"
                }`}
                disabled={!canSave}
                onClick={mode === "create" ? saveCategory : updateCategory}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
