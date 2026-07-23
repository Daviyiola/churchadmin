"use client";

type Props = {
  open: boolean;
  onClose: () => void;
};

const roles = [
  {
    name: "Owner",
    tone: "border-violet-200 bg-violet-50 text-violet-950",
    summary: "Full organization control and final authority.",
    capabilities: [
      "All supported operational, financial, reporting, and historical access.",
      "Manage organization settings, Nikky, invitations, users, and roles.",
      "Merge or delete member records and perform other protected actions.",
      "Remove or demote admins and other high-trust users.",
    ],
    limits: [
      "Sensitive actions still require confirmation and remain subject to audit and application safeguards.",
    ],
  },
  {
    name: "Admin",
    tone: "border-blue-200 bg-blue-50 text-blue-950",
    summary: "Broad administration without owner-level authority.",
    capabilities: [
      "All supported operational, financial, reporting, and historical access.",
      "Manage settings, categories, invitations, and most organization users.",
      "Merge or delete member records and send Member Giving emails.",
      "Configure Nikky and use all admin-level Nikky tools and reports.",
    ],
    limits: [
      "Cannot remove or demote an owner or another protected admin; those actions require an owner.",
    ],
  },
  {
    name: "Finance",
    tone: "border-emerald-200 bg-emerald-50 text-emerald-950",
    summary: "Finance and operations access with deliberate safeguards.",
    capabilities: [
      "Manage income and expenses and use approved financial reports inside the 90-day finance window.",
      "Work with attendance, members, visitors, follow-ups, schedules, and email broadcasts.",
      "Edit and archive or restore member records.",
      "Use Nikky for permitted organization questions and aggregate financial analysis inside the finance window.",
    ],
    limits: [
      "Cannot delete or merge members, manage organization users, or change protected settings.",
      "Cannot run individual Member Giving reports, send Member Giving emails, or ask Nikky for a named person's giving.",
    ],
  },
  {
    name: "Member",
    tone: "border-slate-200 bg-slate-50 text-slate-900",
    summary: "Limited day-to-day access without sensitive administration.",
    capabilities: [
      "View or enter supported non-financial operational records where the feature permits.",
      "Use ordinary member and attendance workflows made available by the organization.",
    ],
    limits: [
      "No Nikky access or sensitive financial management and reports.",
      "Cannot manage users or settings, send organization broadcasts, merge or delete members, or perform protected publishing and administrative actions.",
    ],
  },
] as const;

export default function UserRoleInfoModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/45 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-info-title"
      onMouseDown={onClose}
    >
      <div
        className="my-auto flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-7 sm:py-5">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-primary">
              Organization access
            </div>
            <h2
              id="role-info-title"
              className="mt-1 text-xl font-semibold text-slate-900"
            >
              What can each user role do?
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              Assign the least powerful role a person needs. Church Admin
              verifies permissions again when protected actions are requested;
              hiding a button is not the security boundary.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-xl border px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-7">
          <div className="grid gap-4 md:grid-cols-2">
            {roles.map((role) => (
              <section
                key={role.name}
                className={`rounded-3xl border p-5 ${role.tone}`}
              >
                <h3 className="text-lg font-semibold">{role.name}</h3>
                <p className="mt-1 text-sm font-medium">{role.summary}</p>

                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                    Can
                  </div>
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-5">
                    {role.capabilities.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <div className="mt-4">
                  <div className="text-xs font-semibold uppercase tracking-wide opacity-70">
                    Important limits
                  </div>
                  <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-5">
                    {role.limits.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </section>
            ))}
          </div>

          <p className="mt-4 rounded-2xl border bg-slate-50 p-4 text-xs leading-5 text-slate-600">
            Access can also depend on record status, date, organization
            configuration, and the specific feature. Financial access for the
            finance role uses Church Admin&apos;s existing 90-day finance
            window.
          </p>
        </div>

        <div className="flex justify-end border-t bg-white px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/85"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
