// lib/utils/color.ts
export function hexToRgbTriplet(hex: string) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;

  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);

  if ([r, g, b].some(Number.isNaN)) return null;
  return `${r} ${g} ${b}`;
}

export function rgbTripletToHex(triplet: string | null | undefined) {
  if (!triplet) return null;
  const parts = triplet.trim().split(/\s+/).map((x) => Number(x));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;

  const [r, g, b] = parts;
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
