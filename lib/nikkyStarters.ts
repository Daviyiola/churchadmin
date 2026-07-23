export type NikkyStarterRole = "owner" | "admin" | "finance" | string | null;

const attendanceDiagnostics = [
  "Which registered members have not checked in during the last four Sundays?",
  "Whose attendance declined in the latest three completed months compared with the previous three?",
  "Which members may need a pastoral follow-up based on recorded attendance?",
] as const;

const givingDiagnostics = [
  "Which regular Tithe givers have no recorded Tithe in the latest three completed months?",
  "Which recurring donors reduced their giving in the latest three completed months?",
  "Whose giving frequency changed significantly between the latest two three-month periods?",
] as const;

const ownerGeneral = [
  "What was the attendance for last Sunday?",
  "What is total giving this month?",
  "Generate a baptism report for this year",
  "What's the largest expense category this month?",
  "How many new members this year?",
] as const;

const financeSafe = [
  "What was the attendance for last Sunday?",
  "What is total giving this month?",
  "What's the largest expense category this month?",
  "Generate a Quick Expense report for this month",
  "How many new members this year?",
] as const;

export function nikkyStarters(role: NikkyStarterRole, rotation: number) {
  const offset = Math.max(0, Math.trunc(rotation));
  if (role === "finance") {
    return [0, 1, 2].map((index) => financeSafe[(offset + index) % financeSafe.length]);
  }
  return [
    attendanceDiagnostics[offset % attendanceDiagnostics.length],
    givingDiagnostics[offset % givingDiagnostics.length],
    ownerGeneral[offset % ownerGeneral.length],
  ];
}
