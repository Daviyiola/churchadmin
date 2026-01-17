"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";

type MemberRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  joined_at: string | null;
  status: "active" | "archived";
  created_at: string;

  gender: "male" | "female";
  dob: string | null;
  age_group: "1-12" | "13-17" | "18-35" | "36+";
  segment: "men" | "women" | "boys" | "girls";
  address: string | null;
  notes: string | null;
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
  return data?.role === "admin";
}

function formatDate(d?: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString();
}

function computeAge(dobStr: string) {
  const d = new Date(dobStr);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

function ageGroupForAge(age: number): "1-12" | "13-17" | "18-35" | "36+" {
  if (age <= 12) return "1-12";
  if (age <= 17) return "13-17";
  if (age <= 35) return "18-35";
  return "36+";
}

function computeSegment(
  g: "male" | "female" | "",
  ag: "1-12" | "13-17" | "18-35" | "36+" | ""
): "" | "men" | "women" | "boys" | "girls" {
  if (!g || !ag) return "";
  const under18 = ag === "1-12" || ag === "13-17";
  if (under18) return g === "male" ? "boys" : "girls";
  return g === "male" ? "men" : "women";
}

export default function MembersPage() {
  const orgId = getActiveOrgId();

  const [tab, setTab] = useState<"active" | "archived">("active");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [isAdmin, setIsAdmin] = useState(false);

  // modal state
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editId, setEditId] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [joinedAt, setJoinedAt] = useState<string>("");
  const [notes, setNotes] = useState("");

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>("");

  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [dob, setDob] = useState<string>("");
  const [ageGroup, setAgeGroup] = useState<"1-12" | "13-17" | "18-35" | "36+" | "">("");
  const [address, setAddress] = useState<string>("");

  const requiredOk =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    gender !== "" &&
    ageGroup !== "";

  const segment = computeSegment(gender, ageGroup);

  const dobAge = dob ? computeAge(dob) : null;
  const dobConflict =
    dobAge !== null && ageGroup !== "" && ageGroupForAge(dobAge) !== ageGroup;

  const formError =
    !requiredOk
      ? "First name, last name, gender, and age group are required."
      : dobConflict
      ? "Date of birth does not match the selected age group."
      : segment === ""
      ? "Segment could not be computed."
      : "";

  const canSave =
    requiredOk &&
    !dobConflict &&
    segment !== "" &&
    (mode === "create" || (mode === "edit" ? isAdmin : true));

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((m) => {
      const name = `${m.first_name} ${m.last_name}`.toLowerCase();
      const em = (m.email || "").toLowerCase();
      const ph = (m.phone || "").toLowerCase();
      return name.includes(needle) || em.includes(needle) || ph.includes(needle);
    });
  }, [q, rows]);

  const resetForm = () => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setJoinedAt("");
    setNotes("");
    setErr("");
    setEditId(null);
    setGender("");
    setDob("");
    setAgeGroup("");
    setAddress("");
  };

  const openCreate = () => {
    resetForm();
    setMode("create");
    setOpen(true);
  };

  const openEdit = (m: MemberRow) => {
    resetForm();
    setMode("edit");
    setEditId(m.id);
    setFirstName(m.first_name);
    setLastName(m.last_name);
    setEmail(m.email || "");
    setPhone(m.phone || "");
    setJoinedAt(m.joined_at || "");
    setGender(m.gender);
    setDob(m.dob || "");
    setAgeGroup(m.age_group);
    setAddress(m.address || "");
    setNotes(m.notes || "");
    setOpen(true);
  };

  const load = async () => {
    if (!orgId) return;

    setLoading(true);
    setErr("");

    const [adminFlag] = await Promise.all([isAdminForActiveOrg(orgId)]);
    setIsAdmin(adminFlag);

    const { data, error } = await supabase
      .from("members")
      .select("id,first_name,last_name,email,phone,joined_at,status,created_at,gender,dob,age_group,segment,address,notes")
      .eq("org_id", orgId)
      .eq("status", tab)
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true });

    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
      setRows((data || []) as MemberRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, tab]);

  const saveMember = async () => {
    if (!orgId) return;
    setErr("");

    if (!requiredOk) {
      setErr("First name, last name, gender, and age group are required.");
      return;
    }
    if (dobConflict) {
      setErr("Date of birth does not match the selected age group.");
      return;
    }
    if (!segment) {
      setErr("Segment could not be computed.");
      return;
    }
    if (mode === "edit" && !isAdmin) {
      setErr("Only admins can edit member info.");
      return;
    }

    setSaving(true);

    if (mode === "create") {
      const { error } = await supabase.from("members").insert({
        org_id: orgId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        joined_at: joinedAt || null,
        status: "active",
        notes: notes.trim() || null,
        gender: gender,
        dob: dob || null,
        age_group: ageGroup,
        segment: segment,
        address: address.trim() || null,
      });

      if (error) setErr(error.message);
      else {
        setOpen(false);
        resetForm();
        await load();
      }
    } else {
      if (!isAdmin) {
        setErr("Only admins can edit member info.");
        setSaving(false);
        return;
      }

      const { error } = await supabase
        .from("members")
        .update({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          joined_at: joinedAt || null,
          notes: notes.trim() || null,
          updated_at: new Date().toISOString(),
          gender: gender,
          dob: dob || null,
          age_group: ageGroup,
          segment: segment,
          address: address.trim() || null,
        })
        .eq("id", editId);

      if (error) setErr(error.message);
      else {
        setOpen(false);
        resetForm();
        await load();
      }
    }

    setSaving(false);
  };

  const setStatus = async (id: string, next: "active" | "archived") => {
    if (!isAdmin) {
      setErr("Only admins can archive/restore members.");
      return;
    }
    setErr("");
    const { error } = await supabase
      .from("members")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", id);

    if (error) setErr(error.message);
    else await load();
  };

  const deleteMember = async (id: string) => {
    if (!isAdmin) {
      setErr("Only admins can remove members.");
      return;
    }
    setErr("");
    const ok = confirm("Delete this member? This cannot be undone.");
    if (!ok) return;

    const { error } = await supabase.from("members").delete().eq("id", id);
    if (error) setErr(error.message);
    else await load();
  };

  return (
    <>
      {/* Top bar (Income-style) */}
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Members</div>
            <div className="text-sm text-slate-600">
              {tab === "active" ? "Active members" : "Archived members"}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/85"
              onClick={openCreate}
            >
              Add Member
            </button>
          </div>
        </div>

        <div className="px-6 pb-5">
          <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="inline-flex rounded-2xl border bg-slate-50 p-1">
              <button
                className={`rounded-2xl px-4 py-2 text-sm ${
                  tab === "active" ? "bg-white border shadow-sm" : "text-slate-600 hover:bg-white"
                }`}
                onClick={() => setTab("active")}
              >
                Active
              </button>
              <button
                className={`rounded-2xl px-4 py-2 text-sm ${
                  tab === "archived" ? "bg-white border shadow-sm" : "text-slate-600 hover:bg-white"
                }`}
                onClick={() => setTab("archived")}
              >
                Archived
              </button>
            </div>

            <input
              className="w-full sm:w-96 rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="Search name, phone, email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
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
            <div className="min-w-[900px]">
              <div className="grid grid-cols-12 border-b bg-primary px-5 py-4 text-sm font-semibold text-slate-100 rounded-t-3xl">
                <div className="col-span-3">Name</div>
                <div className="col-span-2">Gender</div>
                <div className="col-span-3">Email</div>
                <div className="col-span-2">Phone</div>                
                <div className="col-span-2 text-right">Actions</div>
              </div>

              {loading ? (
                <div className="p-6 text-sm text-slate-600">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="p-6 text-sm text-slate-600">
                  {q.trim()
                    ? "No members match your search."
                    : tab === "active"
                    ? "No active members yet."
                    : "No archived members."}
                </div>
              ) : (
                <div className="divide-y">
                  {filtered.map((m) => (
                    <div key={m.id} className="grid grid-cols-12 items-center px-5 py-4 text-sm">
                      <div className="col-span-3">
                        <div className="font-semibold capitalize">
                          {m.first_name} {m.last_name}
                        </div>
                        <div className="text-xs text-slate-500">{m.status}</div>
                      </div>
                      <div className="col-span-2 text-slate-700 capitalize">{m.gender || "—"}</div>
                      <div className="col-span-3 text-slate-700">{m.email || "—"}</div>
                      <div className="col-span-2 text-slate-700 ">{m.phone || "—"}</div>

                      <div className="col-span-2 flex justify-end gap-2">
                        {isAdmin ? (
                          <>
                            <button
                              className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                              onClick={() => openEdit(m)}
                            >
                              Edit
                            </button>

                            {m.status === "active" ? (
                              <button
                                className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                                onClick={() => setStatus(m.id, "archived")}
                              >
                                Archive
                              </button>
                            ) : (
                              <button
                                className="rounded-xl border px-3 py-1 text-xs hover:bg-slate-50"
                                onClick={() => setStatus(m.id, "active")}
                              >
                                Restore
                              </button>
                            )}

                            <button
                              className="rounded-xl border border-red-200 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                              onClick={() => deleteMember(m.id)}
                            >
                              Delete
                            </button>
                          </>
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

        {!isAdmin ? (
          <div className="mt-4 text-xs text-slate-500">
            You can add members, but only admins can edit, archive/restore, or delete member info.
          </div>
        ) : null}
      </div>

      {/* Modal */}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-3xl rounded-3xl bg-white shadow-xl">
            <div className="border-b px-6 py-4">
              <div className="text-sm font-semibold">
                {mode === "create" ? "Add member" : "Edit member"}
              </div>
              <div className="text-xs text-slate-600">
                {mode === "create"
                  ? "Anyone can add a member."
                  : isAdmin
                  ? "Admin-only edit."
                  : "Admin-only edit (you are not an admin)."}
              </div>
            </div>

            <div className="max-h-[75vh] overflow-auto px-6 py-6 space-y-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">First name</div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={firstName}
                    onChange={(e) => {
                      setFirstName(e.target.value);
                      setErr("");
                    }}
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Last name</div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={lastName}
                    onChange={(e) => {
                      setLastName(e.target.value);
                      setErr("");
                    }}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Gender *</div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={gender}
                    onChange={(e) => {
                      setGender(e.target.value as "male" | "female");
                      setErr("");
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Age group *</div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={ageGroup}
                    onChange={(e) => {
                      setAgeGroup(e.target.value as "1-12" | "13-17" | "18-35" | "36+");
                      setErr("");
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="1-12">1 to 12</option>
                    <option value="13-17">13 to 17</option>
                    <option value="18-35">18 to 35</option>
                    <option value="36+">36 and above</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Date of birth</div>
                  <input
                    type="date"
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={dob}
                    onChange={(e) => {
                      setDob(e.target.value);
                      setErr("");
                    }}
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Segment (auto)</div>
                  <input
                    readOnly
                    className="w-full rounded-2xl border bg-slate-50 px-4 py-2 text-sm text-slate-700"
                    value={segment || "—"}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Email</div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setErr("");
                    }}
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Phone</div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <div className="mb-1 text-xs font-semibold text-slate-600">Home address</div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Joined</div>
                  <input
                    type="date"
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={joinedAt}
                    onChange={(e) => setJoinedAt(e.target.value)}
                  />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Notes</div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              {formError ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  {formError}
                </div>
              ) : null}

              {err ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {err}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
              <button
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => {
                  setOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl px-4 py-2 text-sm font-semibold text-white ${
                  saving || !canSave ? "bg-slate-300" : "bg-slate-900 hover:bg-slate-800"
                }`}
                disabled={!canSave || saving}
                onClick={saveMember}
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
