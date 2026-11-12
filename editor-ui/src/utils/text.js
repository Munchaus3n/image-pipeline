// Shared text helpers: natural sorting and the loose matching used for template
// auto-match (and template search).

export function naturalParts(value = "") {
  return String(value)
    .toLowerCase()
    .split(/(\d+)/)
    .filter(Boolean)
    .map(part => (/^\d+$/.test(part) ? Number(part) : part));
}

// Natural compare of two names: "cup_2" sorts before "cup_10", case-insensitive.
export function compareNatural(a, b) {
  const aParts = naturalParts(a);
  const bParts = naturalParts(b);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i += 1) {
    if (aParts[i] === undefined) return -1;
    if (bParts[i] === undefined) return 1;
    if (aParts[i] === bParts[i]) continue;
    if (typeof aParts[i] === "number" && typeof bParts[i] === "number") return aParts[i] - bParts[i];
    return String(aParts[i]).localeCompare(String(bParts[i]));
  }
  return 0;
}

// Letters and digits only, lower-case, accents removed; `index` maps each kept
// character back to its position in `text` so digit boundaries can be checked.
export function compactForMatch(value) {
  const text = String(value || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  let compact = "";
  const index = [];
  for (let i = 0; i < text.length; i += 1) {
    if (/[\p{L}\p{N}]/u.test(text[i])) {
      compact += text[i];
      index.push(i);
    }
  }
  return { text, compact, index };
}

export function templateKeywords(tpl) {
  return String(tpl?.match || "")
    .split(/[,;\n]+/)
    .map(word => word.trim())
    .filter(Boolean);
}

