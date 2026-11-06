/** Path-segment tree for VCS file lists (Changes / Log / Compare). */

export type PathTreeFileMeta = {
  path: string;
  origPath?: string | null;
  /** Directory entry that is itself a leaf (e.g. untracked `target/`). */
  directoryLeaf?: boolean;
};

export type PathTreeNode<T extends PathTreeFileMeta = PathTreeFileMeta> = {
  id: string;
  name: string;
  kind: "folder" | "file";
  /** Depth from section root (0 = top). */
  depth: number;
  children?: PathTreeNode<T>[];
  file?: T;
};

type FolderAcc<T extends PathTreeFileMeta> = {
  children: Map<string, FolderAcc<T>>;
  file?: T;
};

function splitPath(path: string): { parts: string[]; directoryLeaf: boolean } {
  const normalized = path.replace(/\\/g, "/");
  const directoryLeaf = normalized.endsWith("/");
  const trimmed = normalized.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return { parts: [], directoryLeaf };
  return { parts: trimmed.split("/").filter(Boolean), directoryLeaf };
}

/**
 * Build a directory tree from flat file paths.
 * Paths ending with `/` become selectable folder leaves (unversioned dirs).
 */
export function buildPathTree<T extends PathTreeFileMeta>(files: T[]): PathTreeNode<T>[] {
  const root: FolderAcc<T> = { children: new Map() };

  for (const file of files) {
    const { parts, directoryLeaf } = splitPath(file.path);
    if (!parts.length) continue;
    let cur = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isLast = i === parts.length - 1;
      if (!cur.children.has(part)) {
        cur.children.set(part, { children: new Map() });
      }
      const next = cur.children.get(part)!;
      if (isLast) {
        next.file = { ...file, directoryLeaf: directoryLeaf || !!file.directoryLeaf };
      }
      cur = next;
    }
  }

  function toNodes(folder: FolderAcc<T>, prefix: string, depth: number): PathTreeNode<T>[] {
    const nodes: PathTreeNode<T>[] = [];
    const entries = [...folder.children.entries()].sort(([a], [b]) => a.localeCompare(b));

    for (const [name, child] of entries) {
      const id = prefix ? `${prefix}/${name}` : name;
      const childNodes = toNodes(child, id, depth + 1);

      if (childNodes.length > 0) {
        nodes.push({
          id,
          name,
          kind: "folder",
          depth,
          children: childNodes,
          file: child.file?.directoryLeaf ? child.file : undefined,
        });
        continue;
      }

      if (child.file) {
        const isDir = !!child.file.directoryLeaf;
        nodes.push({
          id: child.file.path,
          name,
          kind: isDir ? "folder" : "file",
          depth,
          file: child.file,
        });
      }
    }

    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return nodes;
  }

  return toNodes(root, "", 0);
}

export type FlatTreeRow<T extends PathTreeFileMeta = PathTreeFileMeta> = {
  node: PathTreeNode<T>;
  expanded: boolean;
};

/**
 * Flatten tree using an expanded-id set.
 * - id present → expanded
 * - `!id` present → collapsed
 * - neither → `defaultExpanded`
 */
export function flattenPathTree<T extends PathTreeFileMeta>(
  nodes: PathTreeNode<T>[],
  expanded: Set<string>,
  defaultExpanded = true,
): FlatTreeRow<T>[] {
  const out: FlatTreeRow<T>[] = [];
  function walk(list: PathTreeNode<T>[]) {
    for (const node of list) {
      const isFolder = node.kind === "folder" && !!node.children?.length;
      let isOpen = false;
      if (isFolder) {
        if (expanded.has(`!${node.id}`)) isOpen = false;
        else if (expanded.has(node.id)) isOpen = true;
        else isOpen = defaultExpanded;
      }
      out.push({ node, expanded: isOpen });
      if (isFolder && isOpen) walk(node.children!);
    }
  }
  walk(nodes);
  return out;
}

/** Collect every expandable folder id. */
export function collectFolderIds<T extends PathTreeFileMeta>(nodes: PathTreeNode<T>[]): string[] {
  const ids: string[] = [];
  function walk(list: PathTreeNode<T>[]) {
    for (const n of list) {
      if (n.kind === "folder" && n.children?.length) {
        ids.push(n.id);
        walk(n.children);
      }
    }
  }
  walk(nodes);
  return ids;
}
