import type { RefEntry } from "@/lib/backend";
import { buildRefTree, flattenRefTree } from "./buildRefTree";

type Section = "recent" | "local" | "remote" | "tags";
export type BranchListRow =
  | { key: string; kind: "header" | "emptyRemote"; section: Section }
  | { key: string; kind: "folder"; label: string; title: string; depth: number }
  | { key: string; kind: "ref"; section: Section; entry: RefEntry; label: string; depth: number };

/** One scroll range for all sections; computed once when references/options change. */
export function branchListRows(
  local: RefEntry[],
  remote: RefEntry[],
  tags: RefEntry[],
  groupByDirectory: boolean,
  showTags: boolean,
  recent: string[] = [],
): BranchListRow[] {
  const rows: BranchListRow[] = [];
  const localByName = new Map(local.map((entry) => [entry.name, entry]));
  const header = (section: Section) =>
    rows.push({ key: `header:${section}`, kind: "header", section });
  const append = (entry: RefEntry, section: Section, label = entry.name, depth = 0) =>
    rows.push({ key: `${section}:${entry.fullName}`, kind: "ref", section, entry, label, depth });
  const recentEntries = [...new Set(recent)]
    .map((name) => localByName.get(name))
    .filter((entry): entry is RefEntry => entry !== undefined);
  if (recentEntries.length) {
    header("recent");
    for (const entry of recentEntries) append(entry, "recent");
  }
  header("local");
  for (const row of flattenRefTree(
    buildRefTree(
      local.map((entry) => entry.name),
      groupByDirectory,
    ),
  )) {
    if (row.kind === "folder") {
      rows.push({
        key: `folder:${row.id}`,
        kind: "folder",
        label: row.label,
        title: row.id,
        depth: row.depth,
      });
    } else {
      const entry = localByName.get(row.refName ?? row.id);
      if (entry) append(entry, "local", row.label, row.depth);
    }
  }
  header("remote");
  for (const entry of remote) append(entry, "remote");
  if (!remote.length) rows.push({ key: "empty:remote", kind: "emptyRemote", section: "remote" });
  if (showTags) {
    header("tags");
    for (const entry of tags) append(entry, "tags");
  }
  return rows;
}
