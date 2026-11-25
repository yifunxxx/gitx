import { workspacePathKey } from "./workspacePath";

/** Translate a workspace-relative file to another root without losing filename case. */
export function relativeToRoot(
  sourceRoot: string,
  relative: string,
  targetRoot: string,
): string | null {
  const source = sourceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const target = targetRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const full = `${source}/${relative}`;
  if (!workspacePathKey(full).startsWith(`${workspacePathKey(target)}/`)) return null;
  return full.slice(target.length + 1);
}
