/** Normalize workspace paths for equality checks (Windows drive letters case-insensitive). */
export function workspacePathKey(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

export function sameWorkspacePath(a: string | null | undefined, b: string): boolean {
  return !!a && workspacePathKey(a) === workspacePathKey(b);
}

/** Folder / repository display name from an absolute path. */
export function folderDisplayName(path: string | null | undefined): string | null {
  if (!path) return null;
  const trimmed = path.replace(/[\\/]+$/, "");
  const name = trimmed.split(/[\\/]/).pop();
  return name || trimmed || null;
}

/** OS window title: `project — gitx`, or `gitx` when no folder is open. */
export function formatWindowTitle(folderPath: string | null | undefined, appName = "gitx"): string {
  const name = folderDisplayName(folderPath);
  return name ? `${name} — ${appName}` : appName;
}
