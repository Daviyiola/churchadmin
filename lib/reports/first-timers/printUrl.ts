// lib/reports/first-timers/printUrl.ts

import type { JoinedFilter } from "./types";

export type BuildFirstTimersPrintUrlArgs = {
  org: string;
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD

  include_archived?: boolean; // default true
  joined?: JoinedFilter; // default "all"
};

export function buildFirstTimersPrintUrl(args: BuildFirstTimersPrintUrlArgs) {
  const p = new URLSearchParams();

  p.set("org", args.org);
  p.set("start", args.start);
  p.set("end", args.end);

  // Defaults
  const includeArchived = args.include_archived ?? true;
  const joined: JoinedFilter = args.joined ?? "all";

  p.set("include_archived", includeArchived ? "1" : "0");
  p.set("joined", joined);

  return `/reports/first-timers?${p.toString()}`;
}
