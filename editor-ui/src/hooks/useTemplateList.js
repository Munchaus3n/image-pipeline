import { useMemo } from "react";
import { compactForMatch, compareNatural, templateKeywords } from "../utils/text.js";
import { zoneRank } from "../utils/zones.js";

export const TEMPLATE_SORTS = [
  { value: "name-asc", label: "Name A to Z" },
  { value: "name-desc", label: "Name Z to A" },
  { value: "zone", label: "Zone color" },
  { value: "modified", label: "Last modified" },
  { value: "created", label: "Creation order" },
];

const timeOf = (tpl) => {
  const t = Date.parse(tpl?.updated_at || tpl?.created_at || "");
  return Number.isFinite(t) ? t : null;
};

// Name, keywords and hint, compared loosely (case, spaces, dashes, underscores ignored)
// like the Editor's auto-match.
function matchesQuery(name, tpl, query) {
  const needle = compactForMatch(query).compact;
  if (!needle) return String(query).trim() === "" || name.toLowerCase().includes(String(query).trim().toLowerCase());
  const haystack = compactForMatch([name, ...templateKeywords(tpl), tpl?.hint || ""].join(" ")).compact;
  return haystack.includes(needle);
}

// Returns [{ name, tpl, index }]. `index` is the position in the saved file, which
// is never changed: auto-match breaks keyword ties by file order.
export function filterAndSortTemplates(templates, { query = "", sort = "name-asc", zones = [] } = {}) {
  let rows = Object.entries(templates || {}).map(([name, tpl], index) => ({ name, tpl, index }));
  if (zones.length) rows = rows.filter(({ tpl }) => zones.includes(tpl?.zone || "none"));
  if (String(query).trim()) rows = rows.filter(({ name, tpl }) => matchesQuery(name, tpl, query));

  const byName = (a, b) => compareNatural(a.name, b.name) || a.index - b.index;
  switch (sort) {
    case "name-desc": rows.sort((a, b) => -byName(a, b)); break;
    case "zone": rows.sort((a, b) => zoneRank(a.tpl?.zone) - zoneRank(b.tpl?.zone) || byName(a, b)); break;
    case "modified":
      rows.sort((a, b) => {
        const ta = timeOf(a.tpl);
        const tb = timeOf(b.tpl);
        if (ta === null && tb === null) return a.index - b.index;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return tb - ta || a.index - b.index;
      });
      break;
    case "created": rows.sort((a, b) => a.index - b.index); break;
    default: rows.sort(byName);
  }
  return rows;
}

export function useTemplateList(templates, { query, sort, zones }) {
  return useMemo(
    () => filterAndSortTemplates(templates, { query, sort, zones }),
    [templates, query, sort, zones],
  );
}
