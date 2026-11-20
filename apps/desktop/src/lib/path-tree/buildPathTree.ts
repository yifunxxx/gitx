/** Path-segment tree for VCS file lists (Changes / Log / Compare). */

export type PathTreeFileMeta = {
  path: string;
  origPath?: string | null;
  /** Directory entry that is itself a leaf (e.g. untracked `target/`). */
  directoryLeaf?: boolean;
};

export type PathTreeNode<T extends PathTreeFileMeta = PathTreeFileMeta> = {
  /** Path identity; combine with kind when keying rows across file/directory replacements. */
  id: string;
  name: string;
  kind: "folder" | "file";
  /** Depth from section root (0 = top). */
  depth: number;
  children?: PathTreeNode<T>[];
  file?: T;
};

type FolderAcc<T extends PathTreeFileMeta> = {
  children?: Map<string, FolderAcc<T>>;
  file?: T;
  directory?: T;
};

function splitPath(path: string): { parts: string[]; directoryLeaf: boolean } {
  const normalized = path.replace(/\\/g, "/");
  const directoryLeaf = normalized.endsWith("/");
  const trimmed = normalized.replace(/^\/+|\/+$/g, "");
  if (!trimmed) return { parts: [], directoryLeaf };
  return { parts: trimmed.split("/").filter(Boolean), directoryLeaf };
}

const nameCollator = new Intl.Collator();

function compareNodes<T extends PathTreeFileMeta>(a: PathTreeNode<T>, b: PathTreeNode<T>): number {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return nameCollator.compare(a.name, b.name);
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
      // File leaves need no map; allocate one only when a path descends here.
      const children = (cur.children ??= new Map());
      let next = children.get(part);
      if (!next) children.set(part, (next = {}));
      if (isLast) {
        const isDirectory = directoryLeaf || !!file.directoryLeaf;
        const meta = { ...file, directoryLeaf: isDirectory };
        if (isDirectory) next.directory = meta;
        else next.file = meta;
      }
      cur = next;
    }
  }

  // Materialize directly into the output arrays. Only pending folders need a
  // stack frame; there is no second full-tree order array or parent-id map.
  const roots: PathTreeNode<T>[] = [];
  type Frame = { folder: FolderAcc<T>; nodes: PathTreeNode<T>[]; id: string; depth: number };
  const frames: Frame[] = [{ folder: root, nodes: roots, id: "", depth: 0 }];
  while (frames.length) {
    const { folder, nodes, id, depth } = frames.pop()!;
    for (const [name, child] of folder.children ?? []) {
      if (child.children?.size) {
        const childId = id ? `${id}/${name}` : name;
        const children: PathTreeNode<T>[] = [];
        nodes.push({
          id: childId,
          name,
          kind: "folder",
          depth,
          children,
          file: child.directory,
        });
        frames.push({ folder: child, nodes: children, id: childId, depth: depth + 1 });
      } else if (child.directory) {
        nodes.push({
          id: child.directory.path,
          name,
          kind: "folder",
          depth,
          file: child.directory,
        });
      }
      // Diffs can contain an old file beside a new directory (or the reverse).
      // Keep that file as a sibling, outside the directory's selectable range.
      if (child.file) {
        nodes.push({
          id: child.file.path,
          name,
          kind: "file",
          depth,
          file: child.file,
        });
      }
    }
    // Preserve the previous bottom-up tie order for locale-equivalent sibling
    // names (e.g. composed/decomposed Unicode), while sorting each layer once.
    if (depth) nodes.reverse();
    nodes.sort(compareNodes);
  }

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
