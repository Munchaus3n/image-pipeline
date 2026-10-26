// Path helpers shared by Input, Pipeline and Editor.
// All comparisons are case-insensitive and treat "\" and "/" alike (Windows paths).

export function toForwardSlashes(path = "") {
  return String(path || "").replace(/\\/g, "/");
}

export function trimTrailingSlashes(path = "") {
  return path.replace(/\/+$/, "");
}

export function normalizeImagePath(path = "") {
  return trimTrailingSlashes(toForwardSlashes(path).trim());
}

// Path of absPath relative to rootPath, or "" when absPath is not inside rootPath.
export function relativePathFromRoot(absPath, rootPath) {
  const absNorm = normalizeImagePath(absPath);
  const rootNorm = normalizeImagePath(rootPath);
  if (!absNorm || !rootNorm) return "";
  const absLower = absNorm.toLowerCase();
  const rootLower = rootNorm.toLowerCase();
  if (absLower === rootLower) return "";
  if (absLower.startsWith(`${rootLower}/`)) return absNorm.slice(rootNorm.length + 1);
  return "";
}

// Stable image id: relative path inside the input folder, or the normalized absolute path.
export function imageIdForPath(absPath, rootPath) {
  return normalizeImagePath(relativePathFromRoot(absPath, rootPath) || absPath);
}
