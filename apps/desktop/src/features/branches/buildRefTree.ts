export type RefTreeNode = {
  id: string;
  label: string;
  kind: "folder" | "ref";
  children?: RefTreeNode[];
  refName?: string;
};

export type RefTreeRow = Omit<RefTreeNode, "children"> & { depth: number };

/** Enumerate every level for list rendering without dropping nested folders. */
export function flattenRefTree(nodes: RefTreeNode[]): RefTreeRow[] {
  const rows: RefTreeRow[] = [];
  const pending = nodes.slice().reverse().map((node) => ({ node, depth: 0 }));
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    const { children, ...row } = node;
    rows.push({ ...row, depth });
    for (const child of children?.slice().reverse() ?? []) {
      pending.push({ node: child, depth: depth + 1 });
    }
  }
  return rows;
}

/** Group `feature/a` under folder `feature` when enabled. */
export function buildRefTree(names: string[], groupByDirectory: boolean): RefTreeNode[] {
export function buildRefTree(names: string[], groupByDirectory: boolean): RefTreeNode[] {
  if (!groupByDirectory) {
    return names.map((name) => ({
      id: name,
      label: name,
      kind: "ref" as const,
      refName: name,
    }));
  }

  type Folder = { children: Map<string, Folder>; refs: string[] };
  const root: Folder = { children: new Map(), refs: [] };

  for (const name of names) {
    const parts = name.split("/");
    if (parts.length === 1) {
      root.refs.push(name);
      continue;
    }
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]!;
      if (!cur.children.has(part)) {
        cur.children.set(part, { children: new Map(), refs: [] });
      }
      cur = cur.children.get(part)!;
    }
    cur.refs.push(name);
  }

  function toNodes(folder: Folder, prefix: string): RefTreeNode[] {
    const nodes: RefTreeNode[] = [];
    const folders = [...folder.children.entries()].sort(([a], [b]) => a.localeCompare(b));
    const folders = [...folder.children.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [label, child] of folders) {
      const id = prefix ? `${prefix}/${label}` : label;
      nodes.push({
        id,
        label,
        kind: "folder",
        children: toNodes(child, id),
      });
    }
    for (const name of [...folder.refs].sort()) {
      const label = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
      nodes.push({ id: name, label, kind: "ref", refName: name });
    }
    return nodes;
  }

  return toNodes(root, "");
}
