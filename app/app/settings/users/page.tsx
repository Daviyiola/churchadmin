"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useRouter } from "next/navigation";
import { getActiveOrgId } from "@/lib/auth";

type Role = "owner" | "admin" | "finance" | "member";
type Status = "active" | "invited";

type Row = {
  key: string;
  user_id: string | null;
  email: string;
  role: Role;
  joined_at: string;
  status: Status;
  token?: string;
  expires_at?: string;
};

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

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "green" | "amber" | "slate";
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

export default function UsersSettingsPage() {
  const router = useRouter();

  const orgId = getActiveOrgId();

  const currentRole =
    typeof window !== "undefined"
      ? localStorage.getItem("active_org_role")
      : null;

  const isAdmin = currentRole === "admin" || currentRole === "owner";

  // Invite modal state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [loadingInvite, setLoadingInvite] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");

  // Page data
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");

  // Toast
  const [toastOpen, setToastOpen] = useState(false);
  const [toastText, setToastText] = useState("Copied to clipboard ");

  const [confirmRemove, setConfirmRemove] = useState<
    null | { user_id: string; email: string }
  >(null);

  const [confirmRemoveInvite, setConfirmRemoveInvite] = useState<
    null | { token: string; email: string }
  >(null);

  const canInvite = useMemo(() => {
    const e = email.trim();
    return !!orgId && e.includes("@") && e.includes(".") && !loadingInvite;
  }, [email, orgId, loadingInvite]);

  const [meId, setMeId] = useState<string | null>(null);

  const [confirmRoleChange, setConfirmRoleChange] = useState<null | {
    user_id: string;
    email: string;
    fromRole: Role;
    toRole: Role;
  }>(null);

  const isAdminRole = (r: Role) => r === "admin";
  const isDemotion =
  !!confirmRoleChange && isAdminRole(confirmRoleChange.fromRole) && !isAdminRole(confirmRoleChange.toRole);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setMeId(data.user?.id ?? null));
  }, []);

  async function loadUsers() {
    if (!orgId) {
      setRows([]);
      setLoadingList(false);
      setListError("No active organization selected. Please sign in again.");
      return;
    }

    setLoadingList(true);
    setListError("");

    const { data: sessionRes } = await supabase.auth.getSession();
    const accessToken = sessionRes.session?.access_token;

    if (!accessToken) {
      setRows([]);
      setLoadingList(false);
      setListError("Unauthorized. Please sign in again.");
      return;
    }

    const res = await fetch("/api/org/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ organization_id: orgId }),
    });

    const json = await res.json();

    if (!res.ok) {
      setRows([]);
      setLoadingList(false);
      setListError(json.error || "Failed to load users.");
      return;
    }

    setRows((json.users ?? []) as Row[]);
    setLoadingList(false);
  }


  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createInvite() {
  if (!orgId) return;

  setInviteError("");
  setInviteUrl("");
  setLoadingInvite(true);

  try {
    const { data: sessionRes } = await supabase.auth.getSession();
    const accessToken = sessionRes.session?.access_token;

    if (!accessToken) {
      setInviteError("Unauthorized. Please sign in again.");
      setLoadingInvite(false);
      return;
    }

    const res = await fetch("/api/invites/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        organization_id: orgId,
        invited_email: email.trim(),
        role,
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      setInviteError(json.error || "Failed to create invite.");
      setLoadingInvite(false);
      return;
    }

    setInviteUrl(json.inviteUrl);
    setLoadingInvite(false);

    loadUsers();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Network error";
      setInviteError(msg);
      setLoadingInvite(false);
    }
  }

  async function updateRole(user_id: string, newRole: Role) {
  if (!orgId) return;

  const { data: sessionRes } = await supabase.auth.getSession();
  const accessToken = sessionRes.session?.access_token;

  if (!accessToken) {
    setToastText("Unauthorized. Please sign in again.");
    setToastOpen(true);
    window.setTimeout(() => setToastOpen(false), 1600);
    return;
  }

  const res = await fetch("/api/org/users/role", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      organization_id: orgId,
      user_id,
      role: newRole,
    }),
  });

  const json = await res.json();

  if (!res.ok) {
    setToastText(json.error || "Failed to update role.");
    setToastOpen(true);
    window.setTimeout(() => setToastOpen(false), 1600);
    return;
  }

  setToastText("Role updated");
  setToastOpen(true);
  window.setTimeout(() => setToastOpen(false), 1600);
  loadUsers();
}


  async function removeUser(user_id: string) {
  if (!orgId) return;

  const { data: sessionRes } = await supabase.auth.getSession();
  const accessToken = sessionRes.session?.access_token;

  if (!accessToken) {
    setToastText("Unauthorized. Please sign in again.");
    setToastOpen(true);
    window.setTimeout(() => setToastOpen(false), 1600);
    return;
  }

  const res = await fetch("/api/org/users/remove", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ organization_id: orgId, user_id }),
  });

  const json = await res.json();
  if (!res.ok) {
    setToastText(json.error || "Failed to remove user.");
    setToastOpen(true);
    window.setTimeout(() => setToastOpen(false), 1600);
    return;
  }

    setToastText("User removed ✓");
    setToastOpen(true);
    window.setTimeout(() => setToastOpen(false), 1600);
    loadUsers();
  }


  async function removeInvite(token: string) {
    if (!orgId) return;

    const { data: sessionRes } = await supabase.auth.getSession();
    const accessToken = sessionRes.session?.access_token;

    if (!accessToken) {
      setToastText("Not signed in.");
      setToastOpen(true);
      window.setTimeout(() => setToastOpen(false), 1600);
      return;
    }

    const res = await fetch("/api/invites/remove", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ organization_id: orgId, token }),
    });

    const json = await res.json();

    if (!res.ok) {
      setToastText(json.error || "Failed to remove invite.");
      setToastOpen(true);
      window.setTimeout(() => setToastOpen(false), 1600);
      return;
    }

    setToastText("Invite removed");
    setToastOpen(true);
    window.setTimeout(() => setToastOpen(false), 1600);
    loadUsers();
  }

  return (
    <>
      <Toast show={toastOpen} text={toastText} />

      {/* Top bar */}
      <div className="border-b">
        <div className="flex items-center justify-between px-6 py-4">
          <div>
            <div className="text-xl font-semibold">Manage users</div>
            <div className="text-sm text-slate-600">
              Invite-only access. Manage roles and access.
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setInviteOpen(true);
                setEmail("");
                setRole("member");
                setInviteUrl("");
                setInviteError("");
              }}
              className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/85"
            >
              Invite user
            </button>
              <button
              className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
              onClick={() => router.push("/app/settings")}
            >
              Back to Settings
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-6">
        <div className="max-w-7xl">
          <div className="rounded-3xl border bg-white p-5">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Current users</div>
              <button
                onClick={loadUsers}
                className="rounded-2xl border px-3 py-1 text-sm hover:bg-slate-50"
              >
                Refresh
              </button>
            </div>

            {loadingList ? (
              <div className="mt-4 text-sm text-slate-600">Loading…</div>
            ) : listError ? (
              <div className="mt-4 text-sm text-red-600">{listError}</div>
            ) : (
              <div className="mt-4 rounded-3xl border bg-white overflow-hidden">
                <div className="overflow-x-auto">
                  <div className="min-w-[900px]">
                    <div className="grid grid-cols-12 border-b bg-primary px-5 py-4 text-sm font-semibold text-slate-100 rounded-t-3xl">
                      <div className="col-span-3">Email</div>
                      <div className="col-span-2">Status</div>
                      <div className="col-span-2">Role</div>
                      <div className="col-span-2">Joined</div>
                      <div className="col-span-3 text-right">Actions</div>
                    </div>

                    {rows.map((r) => {
                      const isMe = !!meId && r.user_id === meId;

                      return (
                        <div
                          key={r.key}
                          className="grid grid-cols-12 items-center px-5 py-3 text-sm border-t"
                        >
                          <div className="col-span-3 min-w-0 font-medium truncate">
                            {r.email || "—"}{" "}
                            {isMe ? <span className="text-xs text-slate-500">(you)</span> : null}
                          </div>

                          <div className="col-span-2">
                            {r.status === "active" ? (
                              <Pill tone="green">Active</Pill>
                            ) : (
                              <Pill tone="amber">Invited</Pill>
                            )}
                          </div>

                          <div className="col-span-2">
                            {r.status === "active" && r.user_id && isAdmin && !isMe ? (
                              <select
                                value={r.role}
                                onChange={(e) => {
                                  const next = e.target.value as Role;
                                  if (next === r.role) return;

                                  setConfirmRoleChange({
                                    user_id: r.user_id!,
                                    email: r.email,
                                    fromRole: r.role,
                                    toRole: next,
                                  });
                                }}
                                className="w-32 min-w-0 rounded-xl capitalize border px-2 py-2 text-sm"
                              >
                                <option value="member">Member</option>
                                <option value="finance">Finance</option>
                                <option value="admin">Admin</option>
                                {/* OPTIONAL: only owners can assign owner (if you later add it) */}
                                {/* {currentRole === "owner" ? <option value="owner">Owner</option> : null} */}
                              </select>
                            ) : (
                              <span className="text-slate-700 capitalize">{String(r.role)}</span>
                            )}
                          </div>


                          <div className="col-span-2 text-slate-600">
                            {fmtDate(r.joined_at)}
                          </div>

                          <div className="col-span-3 flex justify-end gap-2">
                            {r.status === "invited" && r.token ? (
                              <>
                                <button
                                  onClick={() => {
                                    const base =
                                      typeof window !== "undefined"
                                        ? window.location.origin
                                        : "http://localhost:3000";
                                    const url = `${base}/invite/${r.token}`;

                                    setInviteUrl(url);

                                    setEmail(r.email || "");
                                    setRole((r.role as Role) || "member");
                                    setInviteError("");

                                    setInviteOpen(true);

                                    setToastText("Invite link loaded");
                                    setToastOpen(true);
                                    window.setTimeout(() => setToastOpen(false), 1400);
                                  }}
                                  className="inline-flex h-9 w-24 items-center justify-center rounded-xl border text-sm font-medium hover:bg-slate-50"
                                >
                                  View Link
                                </button>

                                {isAdmin ? (
                                  <button
                                    onClick={() =>
                                      setConfirmRemoveInvite({
                                        token: r.token!,
                                        email: r.email,
                                      })
                                    }
                                    className="inline-flex h-9 w-24 items-center justify-center rounded-xl border text-sm font-medium hover:bg-slate-50"
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </>
                            ) : isAdmin && r.status === "active" && r.user_id && !isMe ? (
                              <button
                                onClick={() =>
                                  setConfirmRemove({
                                    user_id: r.user_id!,
                                    email: r.email,
                                  })
                                }
                                className="inline-flex h-9 w-24 items-center justify-center rounded-xl border text-sm font-medium hover:bg-slate-50"
                              >
                                Remove
                              </button>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

            )}
          </div>
        </div>
      </div>

      {/* Change role modal */}
      {confirmRoleChange ? (
      <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
          <div className="text-lg font-semibold">Confirm role change</div>

          <div className="mt-2 text-sm text-slate-600">
            Change{" "}
            <span className="font-semibold">{confirmRoleChange.email}</span>{" "}
            from{" "}
            <span className="font-semibold capitalize">
              {confirmRoleChange.fromRole}
            </span>{" "}
            to{" "}
            <span className="font-semibold capitalize">
              {confirmRoleChange.toRole}
            </span>
            ?
          </div>

          <div className="mt-4 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
            {isAdminRole(confirmRoleChange.toRole)
              ? "This user will be able to manage users and settings."
              : isAdminRole(confirmRoleChange.fromRole) && !isAdminRole(confirmRoleChange.toRole)
              ? "This removes admin privileges from the user."
              : "This updates what the user can access in the app."}                    
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => setConfirmRoleChange(null)}
              className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
            >
              Cancel
            </button>

            <button
              onClick={async () => {
                const c = confirmRoleChange;
                setConfirmRoleChange(null);
                await updateRole(c.user_id, c.toRole);
              }}
              className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/85"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    ) : null}


      {/* Invite modal */}
      {inviteOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">Invite user</div>
                <div className="mt-1 text-sm text-slate-600">
                  Invite-only access
                </div>
              </div>
              <button
                onClick={() => setInviteOpen(false)}
                className="rounded-2xl border px-3 py-1 text-sm hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            {!orgId ? (
              <div className="mt-5 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
                No active organization selected. Please sign in again.
              </div>
            ) : (
              <div className="mt-5">
                <label className="block text-sm font-medium">Email</label>
                <input
                  value={email}
                  disabled={!!inviteUrl}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                  placeholder="user@example.com"
                />

                <label className="mt-4 block text-sm font-medium">Role</label>
                <select
                  value={role}
                  disabled={!!inviteUrl}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="mt-2 w-full rounded-2xl border px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-slate-200"
                >
                  <option value="member">Member</option>
                  <option value="finance">Finance</option>
                  <option value="admin">Admin</option>               
                </select>

                <button
                  onClick={createInvite}
                  disabled={!canInvite || !!inviteUrl || !isAdmin}
                  className="mt-5 w-full rounded-2xl bg-primary px-4 py-3 text-sm font-semibold text-white
                            hover:bg-primary/85 disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  {inviteUrl ? "Invite already created" : !isAdmin? "Only Admins can invite" : loadingInvite ? "Creating invite..." : "Create invite link"}
                </button>
                {inviteError ? (
                  <div className="mt-3 text-sm text-red-600">{inviteError}</div>
                ) : null}

                {inviteUrl ? (
                  <div className="mt-5 rounded-2xl border p-4">
                    <div className="text-sm font-semibold">Invite link</div>
                    <div className="mt-2 flex gap-2">
                      <input
                        readOnly
                        value={inviteUrl}
                        className="flex-1 rounded-2xl border px-3 py-2 text-sm"
                      />
                      <button
                        onClick={async () => {
                          await navigator.clipboard.writeText(inviteUrl);
                          setToastText("Copied to clipboard");
                          setToastOpen(true);
                          window.setTimeout(() => setToastOpen(false), 1600);
                        }}
                        className="rounded-2xl border px-4 py-2 text-sm font-semibold hover:bg-slate-50"
                      >
                        Copy
                      </button>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">
                      Share this link with the invited user. Expires in 7 days.
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* Remove invite confirmation */}
      {confirmRemoveInvite ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <div className="text-lg font-semibold">Remove invite?</div>
            <div className="mt-2 text-sm text-slate-600">
              This will revoke the invite for{" "}
              <span className="font-semibold">{confirmRemoveInvite.email}</span>.
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setConfirmRemoveInvite(null)}
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const t = confirmRemoveInvite.token;
                  setConfirmRemoveInvite(null);
                  await removeInvite(t);
                }}
                className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/85"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Remove confirmation */}
      {confirmRemove ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <div className="text-lg font-semibold">Remove user?</div>
            <div className="mt-2 text-sm text-slate-600">
              This will remove{" "}
              <span className="font-semibold">{confirmRemove.email}</span> from
              the organization.
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setConfirmRemove(null)}
                className="rounded-2xl border px-4 py-2 text-sm hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const u = confirmRemove.user_id;
                  setConfirmRemove(null);
                  await removeUser(u);
                }}
                className="rounded-2xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/85"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
