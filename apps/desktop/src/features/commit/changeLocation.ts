/** Resolve Git status paths without treating shell punctuation as commands. */
export function changeLocation(root: string, relative: string, directory: boolean) {
  const normalized = relative.replace(/\\/g, "/");
  const parts = (directory ? normalized.replace(/\/+$/, "") : normalized).split("/");
  if (
    !root ||
    !relative ||
    /^[\\/]|^[A-Za-z]:/.test(relative) ||
    relative.includes("\0") ||
    parts.some((part) => part === ".." || part === "." || !part)
  ) {
    throw new Error("Invalid repository-relative path");
  }
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const path = `${base}/${parts.join("/")}`;
  const parent = parts.slice(0, -1).join("/");
  return { path, cwd: directory ? path : parent ? `${base}/${parent}` : `${base}/` };
}
