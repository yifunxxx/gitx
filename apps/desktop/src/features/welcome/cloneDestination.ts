/** The last path component, never a URL host, query, or credential. */
export function cloneFolderName(source: string): string {
  let path = source.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return "";
    }
  }
  const leaf = path.replace(/[/\\]+$/, "").split(/[/\\:]/).pop() ?? "";
  let name = leaf;
  try {
    name = decodeURIComponent(leaf);
  } catch {
    // A local repository name may contain a literal percent sign.
  }
  name = name.replace(/\.git$/i, "");
  return validCloneFolderName(name) ? name : "";
}

/** One portable folder name; it must never escape the selected parent. */
export function validCloneFolderName(name: string): boolean {
  return !!name && name === name.trim() && !/[<>:"/\\|?*\u0000-\u001f]/.test(name)
    && !/[. ]$/.test(name) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}

export function cloneDestination(parent: string, name: string): string {
  if (!parent.trim() || !validCloneFolderName(name)) return "";
  const separator = parent.includes("\\") ? "\\" : "/";
  return `${parent.trim().replace(/[/\\]+$/, "")}${separator}${name}`;
}
