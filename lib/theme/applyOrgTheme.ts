export function applyOrgTheme(vars: Partial<{
  primary_rgb: string | null;
  primary_hover_rgb: string | null;
  accent_rgb: string | null;
}>) {
  if (typeof document === "undefined") return;

  const root = document.documentElement;

  if (vars.primary_rgb)
    root.style.setProperty("--color-primary", vars.primary_rgb);

  if (vars.primary_hover_rgb)
    root.style.setProperty("--color-primary-hover", vars.primary_hover_rgb);

  if (vars.accent_rgb)
    root.style.setProperty("--color-accent", vars.accent_rgb);
}
