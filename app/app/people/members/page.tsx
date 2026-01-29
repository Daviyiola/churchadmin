"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { getActiveOrgId } from "@/lib/auth";

type Role = "owner" | "admin" | "finance" | "viewer" | "member";

type AgeGroup = "1-12" | "13-17" | "18-35" | "36+";
type Segment = "men" | "women" | "boys" | "girls";

type YesNo = "yes" | "no" | "";

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
  age_group: AgeGroup;
  segment: Segment;
  address: string | null;
  notes: string | null;

  // ✅ new fields
  baptized: boolean | null;
  baptism_date: string | null; // YYYY-MM-DD
  born_again: boolean | null;
  born_again_date: string | null; // YYYY-MM-DD
};

type DupCandidate = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  dob: string | null;
  status: "active" | "archived" | null;
};

function isYesNo(v: string): v is YesNo {
  return v === "" || v === "yes" || v === "no";
}

function isAgeGroup(v: string): v is AgeGroup | "" {
  return v === "" || v === "1-12" || v === "13-17" || v === "18-35" || v === "36+";
}

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

  const r = (data?.role as Role | undefined) ?? "member";
  return r === "admin" || r === "owner";
}

function normalizeName(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, ""); // keeps letters/numbers/spaces/'/-
}

function normalizeEmail(s: string | null) {
  return (s ?? "").trim().toLowerCase();
}

function normalizePhone(s: string | null) {
  return (s ?? "").replace(/\D/g, ""); // digits only
}

function sameNameOrSwapped(
  aFirst: string,
  aLast: string,
  bFirst: string,
  bLast: string,
): { direct: boolean; swapped: boolean } {
  const af = normalizeName(aFirst);
  const al = normalizeName(aLast);
  const bf = normalizeName(bFirst);
  const bl = normalizeName(bLast);

  const hasAll = af.length > 0 && al.length > 0 && bf.length > 0 && bl.length > 0;

  const direct = hasAll && af === bf && al === bl;
  const swapped = hasAll && af === bl && al === bf;

  return { direct, swapped };
}

function toBoolOrNull(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
    if (s === "yes") return true;
    if (s === "no") return false;
  }
  return null;
}

function toStringOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function computeAgeFromDobOnDate(dobStr: string, onDate = new Date()) {
  const d = new Date(dobStr);
  if (Number.isNaN(d.getTime())) return null;

  // DOB in the future = invalid
  if (d.getTime() > onDate.getTime()) return null;

  let age = onDate.getFullYear() - d.getFullYear();
  const m = onDate.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && onDate.getDate() < d.getDate())) age--;
  return age;
}

function ageGroupForAge(age: number): AgeGroup {
  if (age <= 12) return "1-12";
  if (age <= 17) return "13-17";
  if (age <= 35) return "18-35";
  return "36+";
}

function computeSegment(g: "male" | "female" | "", ag: AgeGroup | ""): "" | Segment {
  if (!g || !ag) return "";
  const under18 = ag === "1-12" || ag === "13-17";
  if (under18) return g === "male" ? "boys" : "girls";
  return g === "male" ? "men" : "women";
}

function isValidPastOrTodayDate(dateStr: string) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return d0 <= t0;
}

function formatCandidate(c: DupCandidate) {
  const fn = (c.first_name ?? "").trim();
  const ln = (c.last_name ?? "").trim();
  const name = `${fn} ${ln}`.trim() || "Unknown";
  const bits: string[] = [];
  if (c.email) bits.push(`email: ${c.email}`);
  if (c.phone) bits.push(`phone: ${c.phone}`);
  if (c.dob) bits.push(`dob: ${c.dob}`);
  if (c.status) bits.push(`status: ${c.status}`);
  return `${name}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

/**
 * Duplicate strategy:
 * - Strong matches (block): same email OR same phone OR (same name or swapped name) + same DOB
 * - Weak matches (warn/confirm): same name OR swapped name (Mary Johnson vs Johnson Mary)
 */
async function findDuplicates(params: {
  orgId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dob: string | null;
}) {
  const fn = normalizeName(params.firstName);
  const ln = normalizeName(params.lastName);

  const em = normalizeEmail(params.email);
  const ph = normalizePhone(params.phone);
  const dob = (params.dob ?? "").trim();

  // Pull a small candidate set from the org that might match by either side of the name.
  // This catches:
  //  - Mary Johnson (fn=Mary ln=Johnson)
  //  - Johnson Mary (fn=Johnson ln=Mary)
  const { data, error } = await supabase
    .from("members")
    .select("id,first_name,last_name,email,phone,dob,status")
    .eq("org_id", params.orgId)
    .eq("membership_stage", "member")
    .or(
      [
        `first_name.ilike.%${fn}%`,
        `last_name.ilike.%${ln}%`,
        `first_name.ilike.%${ln}%`,
        `last_name.ilike.%${fn}%`,
      ].join(","),
    )
    .limit(50);

  if (error) return { strong: [] as DupCandidate[], weak: [] as DupCandidate[], error: error.message };

  const candidates = (data ?? []) as DupCandidate[];

  const strong: DupCandidate[] = [];
  const weak: DupCandidate[] = [];

  for (const c of candidates) {
    const cFirst = (c.first_name ?? "").toString();
    const cLast = (c.last_name ?? "").toString();
    const nameCmp = sameNameOrSwapped(fn, ln, cFirst, cLast);

    const cEmail = normalizeEmail(c.email);
    const cPhone = normalizePhone(c.phone);
    const cDob = (c.dob ?? "").trim();

    const emailMatch = em.length > 0 && cEmail.length > 0 && em === cEmail;
    const phoneMatch = ph.length > 0 && cPhone.length > 0 && ph === cPhone;
    const nameDobMatch =
      (nameCmp.direct || nameCmp.swapped) && dob.length > 0 && cDob.length > 0 && dob === cDob;

    if (emailMatch || phoneMatch || nameDobMatch) {
      strong.push(c);
      continue;
    }

    // Weak: same name or swapped name (Mary Johnson vs Johnson Mary)
    if (nameCmp.direct || nameCmp.swapped) {
      weak.push(c);
    }
  }

  // De-dupe by id in case the OR query returned overlaps
  const uniq = (arr: DupCandidate[]) => {
    const seen = new Set<string>();
    const out: DupCandidate[] = [];
    for (const x of arr) {
      if (seen.has(x.id)) continue;
      seen.add(x.id);
      out.push(x);
    }
    return out;
  };

  return { strong: uniq(strong), weak: uniq(weak), error: null };
}

export default function MembersPage() {
  const orgId = getActiveOrgId();

  const [tab, setTab] = useState<"active" | "archived">("active");
  const [q, setQ] = useState("");
  const [ageGroupFilter, setAgeGroupFilter] = useState<AgeGroup | null>(null);
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
  const [ageGroup, setAgeGroup] = useState<AgeGroup | "">("");
  const [address, setAddress] = useState<string>("");

  // ✅ new fields (form state)
  const [baptized, setBaptized] = useState<YesNo>("");
  const [baptismDate, setBaptismDate] = useState<string>("");
  const [bornAgain, setBornAgain] = useState<YesNo>("");
  const [bornAgainDate, setBornAgainDate] = useState<string>("");

  // DOB drives age group when present
  const hasDob = dob.trim().length > 0;
  const dobAge = hasDob ? computeAgeFromDobOnDate(dob) : null;

  const effectiveAgeGroup = (hasDob
    ? dobAge !== null
      ? ageGroupForAge(dobAge)
      : ""
    : ageGroup) as AgeGroup | "";

  // Required:
  const requiredOk =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    gender !== "" &&
    (hasDob ? dobAge !== null : ageGroup !== "");

  const segment = computeSegment(gender, effectiveAgeGroup);

  const formError = !requiredOk
    ? hasDob
      ? "First name, last name, gender, and a valid date of birth are required."
      : "First name, last name, gender, and age group are required."
    : segment === ""
      ? "Segment could not be computed."
      : "";

  const canSave =
    requiredOk &&
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

  const kpis = useMemo(() => {
    const base = filtered;
    const res = {
      total: { all: 0, male: 0, female: 0 },
      kids: { all: 0, male: 0, female: 0 },
      teens: { all: 0, male: 0, female: 0 },
      young: { all: 0, male: 0, female: 0 },
      adults: { all: 0, male: 0, female: 0 },
    };

    const inc = (bucket: keyof typeof res, g: MemberRow["gender"]) => {
      res[bucket].all += 1;
      if (g === "male") res[bucket].male += 1;
      if (g === "female") res[bucket].female += 1;
    };

    for (const m of base) {
      inc("total", m.gender);
      if (m.age_group === "1-12") inc("kids", m.gender);
      else if (m.age_group === "13-17") inc("teens", m.gender);
      else if (m.age_group === "18-35") inc("young", m.gender);
      else if (m.age_group === "36+") inc("adults", m.gender);
    }

    return res;
  }, [filtered]);

  const displayed = useMemo(() => {
    if (!ageGroupFilter) return filtered;
    return filtered.filter((m) => m.age_group === ageGroupFilter);
  }, [filtered, ageGroupFilter]);

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

    setBaptized("");
    setBaptismDate("");
    setBornAgain("");
    setBornAgainDate("");
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

    setBaptized(m.baptized === true ? "yes" : m.baptized === false ? "no" : "");
    setBaptismDate(m.baptism_date || "");
    setBornAgain(m.born_again === true ? "yes" : m.born_again === false ? "no" : "");
    setBornAgainDate(m.born_again_date || "");

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
      .select(
        "id,first_name,last_name,email,phone,joined_at,status,created_at,gender,dob,age_group,segment,address,notes,baptized,baptism_date,born_again,born_again_date",
      )
      .eq("org_id", orgId)
      .eq("membership_stage", "member")
      .eq("status", tab)
      .order("last_name", { ascending: true })
      .order("first_name", { ascending: true });

    if (error) {
      setErr(error.message);
      setRows([]);
    } else {
  const safe: MemberRow[] = (data ?? []).map((r) => ({
    id: String(r.id),
    first_name: String(r.first_name ?? ""),
    last_name: String(r.last_name ?? ""),
    email: toStringOrNull(r.email),
    phone: toStringOrNull(r.phone),
    joined_at: toStringOrNull(r.joined_at),
    status: (r.status === "archived" ? "archived" : "active") as "active" | "archived",
    created_at: String(r.created_at ?? ""),

    gender: (r.gender === "female" ? "female" : "male") as "male" | "female",
    dob: toStringOrNull(r.dob),
    age_group: (r.age_group ?? "") as AgeGroup,
    segment: (r.segment ?? "") as Segment,
    address: toStringOrNull(r.address),
    notes: toStringOrNull(r.notes),

    baptized: toBoolOrNull(r.baptized),
    baptism_date: toStringOrNull(r.baptism_date),
    born_again: toBoolOrNull(r.born_again),
    born_again_date: toStringOrNull(r.born_again_date),
  }));

  setRows(safe);
}

    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, tab]);

  useEffect(() => {
    setAgeGroupFilter(null);
  }, [tab, orgId]);

  const saveMember = async () => {
    if (!orgId) return;
    setErr("");

    if (firstName.trim().length === 0 || lastName.trim().length === 0 || !gender) {
      setErr("First name, last name, and gender are required.");
      return;
    }

    if (hasDob && dobAge === null) {
      setErr("Please enter a valid date of birth (not in the future).");
      return;
    }

    if (!hasDob && !ageGroup) {
      setErr("Age group is required unless date of birth is provided.");
      return;
    }

    if (!effectiveAgeGroup) {
      setErr("Could not compute age group.");
      return;
    }

    const segmentToSave = computeSegment(gender, effectiveAgeGroup);
    if (!segmentToSave) {
      setErr("Segment could not be computed.");
      return;
    }

    // ✅ normalize new fields
    const baptizedBool = baptized === "" ? null : baptized === "yes";
    const bornAgainBool = bornAgain === "" ? null : bornAgain === "yes";

    const baptismDateToSave = baptizedBool === true ? (baptismDate || null) : null;
    const bornAgainDateToSave = bornAgainBool === true ? (bornAgainDate || null) : null;

    if (baptismDateToSave && !isValidPastOrTodayDate(baptismDateToSave)) {
      setErr("Baptism date must be a valid date (not in the future).");
      return;
    }
    if (bornAgainDateToSave && !isValidPastOrTodayDate(bornAgainDateToSave)) {
      setErr("Born again date must be a valid date (not in the future).");
      return;
    }

    setSaving(true);

    const payload: {
  org_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  joined_at: string | null;
  status: "active" | "archived";
  notes: string | null;
  gender: "male" | "female";
  dob: string | null;
  age_group: AgeGroup;
  segment: Segment;
  address: string | null;
  baptized: boolean | null;
  baptism_date: string | null;
  born_again: boolean | null;
  born_again_date: string | null;
} = {
  org_id: orgId,
  first_name: firstName.trim(),
  last_name: lastName.trim(),
  email: email.trim() || null,
  phone: phone.trim() || null,
  joined_at: joinedAt || null,
  status: "active",
  notes: notes.trim() || null,
  gender,
  dob: dob.trim() ? dob.trim() : null,
  age_group: effectiveAgeGroup,
  segment: segmentToSave,
  address: address.trim() || null,
  baptized: baptizedBool,
  baptism_date: baptismDateToSave,
  born_again: bornAgainBool,
  born_again_date: bornAgainDateToSave,
};


    // ✅ DUPLICATE CHECK (create only)
    if (mode === "create") {
      const dup = await findDuplicates({
        orgId,
        firstName,
        lastName,
        email: email.trim() || null,
        phone: phone.trim() || null,
        dob: dob.trim() ? dob.trim() : null,
      });

      if (dup.error) {
        setErr(dup.error);
        setSaving(false);
        return;
      }

      // Strong duplicates: block
      if (dup.strong.length > 0) {
        const examples = dup.strong.slice(0, 3).map(formatCandidate).join("\n• ");
        setErr(
          `Possible duplicate found (strong match). Please check existing records before adding.\n\n• ${examples}${
            dup.strong.length > 3 ? `\n• …and ${dup.strong.length - 3} more` : ""
          }`,
        );
        setSaving(false);
        return;
      }

      // Weak duplicates: warn (including swapped names e.g., "Mary Johnson" vs "Johnson Mary")
      if (dup.weak.length > 0) {
        const examples = dup.weak.slice(0, 3).map(formatCandidate).join("\n• ");
        const ok = confirm(
          `Possible duplicate found (name match — including swapped first/last like “Mary Johnson” vs “Johnson Mary”).\n\n• ${examples}${
            dup.weak.length > 3 ? `\n• …and ${dup.weak.length - 3} more` : ""
          }\n\nAdd anyway?`,
        );
        if (!ok) {
          setSaving(false);
          return;
        }
      }

      const { error } = await supabase.from("members").insert(payload);

      if (error) setErr(error.message);
      else {
        setOpen(false);
        resetForm();
        await load();
      }

      setSaving(false);
      return;
    }

    // Edit
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
        dob: dob.trim() ? dob.trim() : null,
        age_group: effectiveAgeGroup,
        segment: segmentToSave,
        address: address.trim() || null,

        baptized: baptizedBool,
        baptism_date: baptismDateToSave,
        born_again: bornAgainBool,
        born_again_date: bornAgainDateToSave,
      })
      .eq("id", editId);

    if (error) setErr(error.message);
    else {
      setOpen(false);
      resetForm();
      await load();
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
      {/* Top bar */}
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

            <input
              className="w-full sm:w-96 rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
              placeholder="Search name, phone, email…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          {err ? (
            <div className="mt-3 whitespace-pre-line rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
              {/* KPI row */}
              <div className="border-b bg-white px-5 py-6">
                <div className="flex items-center justify-between gap-3">
                  {ageGroupFilter ? (
                    <button
                      type="button"
                      className="rounded-xl border px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      onClick={() => setAgeGroupFilter(null)}
                      title="Clear age filter"
                    >
                      Clear filter ✕
                    </button>
                  ) : (
                    <div className="text-xs text-slate-500">
                      Click a card to filter the table.
                    </div>
                  )}
                </div>

                <div className="mt-2 grid gap-7 sm:grid-cols-2 lg:grid-cols-5">
                  {/* Total */}
                  <button
                    type="button"
                    onClick={() => setAgeGroupFilter(null)}
                    className={`rounded-2xl border px-4 py-3 text-left transition bg-white hover:bg-slate-50 ${
                      ageGroupFilter === null ? "bg-white border-primary" : "bg-white hover:bg-slate-50"
                    }`}
                    title="Show all age groups"
                  >
                    <div className="text-xs font-semibold text-slate-600">Total members</div>
                    <div className="mt-1 flex items-end justify-between gap-3">
                      <div className="text-2xl font-semibold text-slate-900">{kpis.total.all}</div>
                      <div className="text-[11px] text-slate-600 flex gap-3">
                        <span>
                          <span className="font-semibold">Female</span>: {kpis.total.female}
                        </span>
                        <span>
                          <span className="font-semibold">Male</span>: {kpis.total.male}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Children */}
                  <button
                    type="button"
                    onClick={() => setAgeGroupFilter((cur) => (cur === "1-12" ? null : "1-12"))}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      ageGroupFilter === "1-12" ? "bg-primary/15 border-primary" : "bg-white hover:bg-slate-50"
                    }`}
                    title="Filter to Children (1–12)"
                  >
                    <div className="text-xs font-semibold text-slate-600">Children (1–12)</div>
                    <div className="mt-1 flex items-end justify-between gap-3">
                      <div className="text-2xl font-semibold text-slate-900">{kpis.kids.all}</div>
                      <div className="text-[11px] text-slate-600 flex gap-3">
                        <span>
                          <span className="font-semibold">Female</span>: {kpis.kids.female}
                        </span>
                        <span>
                          <span className="font-semibold">Male</span>: {kpis.kids.male}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Teenagers */}
                  <button
                    type="button"
                    onClick={() => setAgeGroupFilter((cur) => (cur === "13-17" ? null : "13-17"))}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      ageGroupFilter === "13-17" ? "bg-primary/15 border-primary" : "bg-white hover:bg-slate-50"
                    }`}
                    title="Filter to Teenagers (13–17)"
                  >
                    <div className="text-xs font-semibold text-slate-600">Teenagers (13–17)</div>
                    <div className="mt-1 flex items-end justify-between gap-3">
                      <div className="text-2xl font-semibold text-slate-900">{kpis.teens.all}</div>
                      <div className="text-[11px] text-slate-600 flex gap-3">
                        <span>
                          <span className="font-semibold">Female</span>: {kpis.teens.female}
                        </span>
                        <span>
                          <span className="font-semibold">Male</span>: {kpis.teens.male}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Young adults */}
                  <button
                    type="button"
                    onClick={() => setAgeGroupFilter((cur) => (cur === "18-35" ? null : "18-35"))}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      ageGroupFilter === "18-35" ? "bg-primary/15 border-primary" : "bg-white hover:bg-slate-50"
                    }`}
                    title="Filter to Young adults (18–35)"
                  >
                    <div className="text-xs font-semibold text-slate-600">Young adults (18–35)</div>
                    <div className="mt-1 flex items-end justify-between gap-3">
                      <div className="text-2xl font-semibold text-slate-900">{kpis.young.all}</div>
                      <div className="text-[11px] text-slate-600 flex gap-3">
                        <span>
                          <span className="font-semibold">Female</span>: {kpis.young.female}
                        </span>
                        <span>
                          <span className="font-semibold">Male</span>: {kpis.young.male}
                        </span>
                      </div>
                    </div>
                  </button>

                  {/* Adults */}
                  <button
                    type="button"
                    onClick={() => setAgeGroupFilter((cur) => (cur === "36+" ? null : "36+"))}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${
                      ageGroupFilter === "36+" ? "bg-primary/15 border-primary" : "bg-white hover:bg-slate-50"
                    }`}
                    title="Filter to Adults (36+)"
                  >
                    <div className="text-xs font-semibold text-slate-600">Adults (36+)</div>
                    <div className="mt-1 flex items-end justify-between gap-3">
                      <div className="text-2xl font-semibold text-slate-900">{kpis.adults.all}</div>
                      <div className="text-[11px] text-slate-600 flex gap-3">
                        <span>
                          <span className="font-semibold">Female</span>: {kpis.adults.female}
                        </span>
                        <span>
                          <span className="font-semibold">Male</span>: {kpis.adults.male}
                        </span>
                      </div>
                    </div>
                  </button>
                </div>

                <div className="mt-3 text-xs text-slate-500">
                  Showing <span className="font-semibold">{displayed.length}</span>{" "}
                  {displayed.length === 1 ? "member" : "members"}
                  {q.trim() ? ` matching “${q.trim()}”` : ""}
                  {ageGroupFilter
                    ? ` in ${
                        ageGroupFilter === "1-12"
                          ? "Children (1–12)"
                          : ageGroupFilter === "13-17"
                            ? "Teenagers (13–17)"
                            : ageGroupFilter === "18-35"
                              ? "Young adults (18–35)"
                              : "Adults (36+)"
                      }`
                    : ""}
                </div>
              </div>

              <div className="grid grid-cols-12 border-b bg-primary px-5 py-4 text-sm font-semibold text-slate-100">
                <div className="col-span-3">Name</div>
                <div className="col-span-2">Gender</div>
                <div className="col-span-3">Email</div>
                <div className="col-span-2">Phone</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>

              {loading ? (
                <div className="p-6 text-sm text-slate-600">Loading…</div>
              ) : displayed.length === 0 ? (
                <div className="p-6 text-sm text-slate-600">
                  {ageGroupFilter ? (
                    <>
                      No members in{" "}
                      <span className="font-semibold">
                        {ageGroupFilter === "1-12"
                          ? "Children (1–12)"
                          : ageGroupFilter === "13-17"
                            ? "Teenagers (13–17)"
                            : ageGroupFilter === "18-35"
                              ? "Young adults (18–35)"
                              : "Adults (36+)"}
                      </span>
                      {q.trim() ? " for this search." : "."}
                    </>
                  ) : q.trim() ? (
                    "No members match your search."
                  ) : tab === "active" ? (
                    "No active members yet."
                  ) : (
                    "No archived members."
                  )}
                </div>
              ) : (
                <div className="divide-y">
                  {displayed.map((m) => (
                    <div key={m.id} className="grid grid-cols-12 items-center px-5 py-4 text-sm">
                      <div className="col-span-3">
                        <div className="font-semibold capitalize">
                          {m.first_name} {m.last_name}
                        </div>
                        <div className="text-xs text-slate-500">{m.status}</div>
                      </div>

                      <div className="col-span-2 text-slate-700 capitalize">{m.gender || "—"}</div>
                      <div className="col-span-3 text-slate-700">{m.email || "—"}</div>
                      <div className="col-span-2 text-slate-700">{m.phone || "—"}</div>

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
            You can add members, but only admins/owners can edit, archive/restore, or delete member info.
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
                      const v = e.target.value;
                      if (v === "" || v === "male" || v === "female") setGender(v);
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
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-600"
                    value={effectiveAgeGroup}
                    disabled={hasDob}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!isAgeGroup(v)) return;
                      setAgeGroup(v);
                      setErr("");
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="1-12">1 to 12</option>
                    <option value="13-17">13 to 17</option>
                    <option value="18-35">18 to 35</option>
                    <option value="36+">36 and above</option>
                  </select>

                  {hasDob ? (
                    <div className="mt-1 text-xs text-slate-500">
                      Age group is set automatically from date of birth. Clear DOB to choose manually.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">Date of birth</div>

                  <div className="flex gap-2">
                    <input
                      type="date"
                      className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                      value={dob}
                      onChange={(e) => {
                        setDob(e.target.value);
                        setErr("");
                      }}
                    />

                    {dob ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-2xl border px-3 py-2 text-sm hover:bg-slate-50"
                        onClick={() => {
                          setDob("");
                          setErr("");
                        }}
                        title="Clear date of birth"
                      >
                        Clear
                      </button>
                    ) : null}
                  </div>
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
                <div className="mb-1 text-xs font-semibold text-slate-600">
                  Home address
                </div>
                <input
                  className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Joined
                  </div>
                  <input
                    type="date"
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={joinedAt}
                    onChange={(e) => setJoinedAt(e.target.value)}
                  />
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Notes
                  </div>
                  <input
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </div>

              {/* ✅ New: Baptism + Born again */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Baptized?
                  </div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={baptized}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!isYesNo(v)) return;
                      setBaptized(v);
                      if (v !== "yes") setBaptismDate("");
                      setErr("");
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Baptism date
                  </div>
                  <input
                    type="date"
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-600"
                    value={baptismDate}
                    disabled={baptized !== "yes"}
                    onChange={(e) => {
                      setBaptismDate(e.target.value);
                      setErr("");
                    }}
                  />
                  {baptized !== "yes" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      Set Baptized to “Yes” to enter a date.
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Born again?
                  </div>
                  <select
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                    value={bornAgain}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (!isYesNo(v)) return;
                      setBornAgain(v);
                      if (v !== "yes") setBornAgainDate("");
                      setErr("");
                    }}
                  >
                    <option value="">Select…</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>

                <div>
                  <div className="mb-1 text-xs font-semibold text-slate-600">
                    Born again date
                  </div>
                  <input
                    type="date"
                    className="w-full rounded-2xl border px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200 disabled:bg-slate-50 disabled:text-slate-600"
                    value={bornAgainDate}
                    disabled={bornAgain !== "yes"}
                    onChange={(e) => {
                      setBornAgainDate(e.target.value);
                      setErr("");
                    }}
                  />
                  {bornAgain !== "yes" ? (
                    <div className="mt-1 text-xs text-slate-500">
                      Set Born again to “Yes” to enter a date.
                    </div>
                  ) : null}
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

            <div className="flex items-center justify-between gap-3 border-t px-4 py-4">
              <button
                className="rounded-2xl border min-w-[96px] px-4 py-2 text-sm hover:bg-slate-50"
                onClick={() => {
                  setOpen(false);
                  resetForm();
                }}
              >
                Cancel
              </button>

              <button
                className={`rounded-2xl min-w-[96px] px-4 py-2 text-sm font-semibold text-white ${
                  saving || !canSave
                    ? "bg-slate-300"
                    : "bg-slate-900 hover:bg-slate-800"
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
