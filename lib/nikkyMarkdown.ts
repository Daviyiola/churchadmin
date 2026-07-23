export function normalizeNikkyMarkdown(content: string) {
  const withTableRows = content
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const looksLikeCompactTable =
        trimmed.startsWith("|") &&
        /\|\s*:?-{3,}:?\s*\|/u.test(trimmed) &&
        /\|\s+\|/u.test(trimmed);

      return looksLikeCompactTable
        ? line.replace(/\|\s+\|/gu, "|\n|")
        : line;
    })
    .join("\n");

  return withTableRows.replace(
    /\*\*\s*([^*\n]+?)\s*\*\*/g,
    (match, inner: string, offset: number, source: string) => {
      const before = source[offset - 1] ?? "";
      const after = source[offset + match.length] ?? "";
      const leadingSpace = before && !/\s/u.test(before) && !"([{'\"“‘".includes(before) ? " " : "";
      const trailingSpace = after && !/\s/u.test(after) && !".,;:!?)}]'\"”’".includes(after) ? " " : "";
      return `${leadingSpace}**${inner.trim()}**${trailingSpace}`;
    },
  );
}
