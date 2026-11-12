// Placement zones: the four guide rectangles on the canvas, plus "none".
export const ZONES = ["none", "green", "blue", "magenta", "red"];

const ZONE_VAR = {
  none: "var(--zone-none)",
  green: "var(--zone-green)",
  blue: "var(--zone-blue)",
  magenta: "var(--zone-magenta)",
  red: "var(--zone-red)",
};

export const zoneColor = (zone) => ZONE_VAR[zone] || ZONE_VAR.none;

// Order used when sorting by color.
const ZONE_RANK = { green: 0, blue: 1, magenta: 2, red: 3 };
export const zoneRank = (zone) => (zone in ZONE_RANK ? ZONE_RANK[zone] : 4);
