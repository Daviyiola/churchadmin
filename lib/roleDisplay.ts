/** Display labels only. Authorization must continue to use the stored role. */
export function roleDisplayLabel(role: string, email?: string | null) {
  if (role === "owner" && email?.trim().toLowerCase() === "davidiyiola15@gmail.com") {
    return "Developer";
  }
  return role ? role.charAt(0).toUpperCase() + role.slice(1) : "—";
}
