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

function compareNodes<T extends PathTreeFileMeta>(a: PathTreeNode<T>, b: PathTreeNode<T>): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name);
}

/**
 * Build a directory tree from flat file paths (Map insert + iterative materialize).
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

  // Materialize FolderAcc → PathTreeNode without recursion: process deepest
  // folders first via an explicit stack, then attach into a parent→children map.
  type Frame = { folder: FolderAcc<T>; id: string; name: string; depth: number; parentId: string | null };
  const frames: Frame[] = [];
  const seed: [string, FolderAcc<T>][] = [...root.children.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [name, child] of seed) {
    frames.push({ folder: child, id: name, name, depth: 0, parentId: null });
  }

  // Pre-order collect every folder/file frame so we can build bottom-up.
  const order: Frame[] = [];
  while (frames.length) {
    const frame = frames.pop()!;
    order.push(frame);
    const nested = [...frame.folder.children.entries()].sort(([a], [b]) => a.localeCompare(b));
    // Push reversed so left-to-right pops in locale order.
    for (let i = nested.length - 1; i >= 0; i--) {
      const [childName, childFolder] = nested[i]!;
      const childId = `${frame.id}/${childName}`;
      frames.push({
        folder: childFolder,
        id: childId,
        name: childName,
        depth: frame.depth + 1,
        parentId: frame.id,
      });
    }
  }

  const childrenOf = new Map<string | null, PathTreeNode<T>[]>();

  // Bottom-up: reverse pre-order so children exist before parents attach them.
  for (let i = order.length - 1; i >= 0; i--) {
    const frame = order[i]!;
    const childNodes = childrenOf.get(frame.id) ?? [];
    childNodes.sort(compareNodes);

    let node: PathTreeNode<T>;
    if (childNodes.length > 0) {
      node = {
        id: frame.id,
        name: frame.name,
        kind: "folder",
        depth: frame.depth,
        children: childNodes,
        file: frame.folder.file?.directoryLeaf ? frame.folder.file : undefined,
      };
    } else if (frame.folder.file) {
      const isDir = !!frame.folder.file.directoryLeaf;
      node = {
        id: frame.folder.file.path,
        name: frame.name,
        kind: isDir ? "folder" : "file",
        depth: frame.depth,
        file: frame.folder.file,
      };
    } else {
      continue;
    }

    const siblings = childrenOf.get(frame.parentId) ?? [];
    siblings.push(node);
    childrenOf.set(frame.parentId, siblings);
  }

  const roots = childrenOf.get(null) ?? [];
  roots.sort(compareNodes);
  return roots;
}

export type FlatTreeRow<T extends PathTreeFileMeta = PathTreeFileMeta> = {
  node: PathTreeNode<T>;
  expanded: boolean;
};

/**
 * Flatten tree using an expanded-id set (iterative stack).
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
  const stack = nodes.slice().reverse();
  while (stack.length) {
    const node = stack.pop()!;
    const isFolder = node.kind === "folder" && !!node.children?.length;
    let isOpen = false;
    if (isFolder) {
      if (expanded.has(`!${node.id}`)) isOpen = false;
      else if (expanded.has(node.id)) isOpen = true;
      else isOpen = defaultExpanded;
    }
    out.push({ node, expanded: isOpen });
    if (isFolder && isOpen) {
      const kids = node.children!;
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]!);
    }
  }
  return out;
}

/** Collect every expandable folder id (iterative). */
export function collectFolderIds<T extends PathTreeFileMeta>(nodes: PathTreeNode<T>[]): string[] {
  const ids: string[] = [];
  const stack = nodes.slice().reverse();
  while (stack.length) {
    const n = stack.pop()!;
    if (n.kind === "folder" && n.children?.length) {
      ids.push(n.id);
      for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]!);
    }
  }
  return ids;
}
