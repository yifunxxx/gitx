import type { GraphRow } from "@/lib/backend";

type Commit = { sha: string; shortSha: string; parents: string[]; refs: string[] };
type Lane = { sha: string; color: number; label: string };

export type RenderGraphRow = {
  graph: GraphRow;
  incoming: boolean;
  edgeColors: number[];
  laneLabels: Record<number, string>;
  nodeLabel: string;
  hiddenParents: string[];
};

export type GraphLayoutResult = {
  rows: RenderGraphRow[];
  maxLane: number;
  colPx: number;
};

export type GraphLayoutOptions = { filtered?: boolean; firstParent?: boolean };

/** Opaque cursor so `loadMore` can resume without rewalking prior rows. */
export type GraphLayoutCursor = {
  optionsKey: string;
  length: number;
  headSha: string | null;
  tailSha: string | null;
  rows: RenderGraphRow[];
  maxLane: number;
  lanes: Array<Lane | undefined>;
  nextColor: number;
};

function optionsKey(options: GraphLayoutOptions) {
  return `${options.filtered ? 1 : 0}:${options.firstParent ? 1 : 0}`;
}

function colPxFor(maxLane: number) {
  return Math.max(48, (maxLane + 1) * 14 + 12);
}

function cloneLanes(lanes: Array<Lane | undefined>): Array<Lane | undefined> {
  return lanes.map((lane) => (lane ? { ...lane } : undefined));
}

function layoutRange(
  commits: readonly Commit[],
  from: number,
  options: GraphLayoutOptions,
  lanes: Array<Lane | undefined>,
  nextColorStart: number,
  maxLaneStart: number,
  visible: Set<string>,
): { rows: RenderGraphRow[]; maxLane: number; nextColor: number; lanes: Array<Lane | undefined> } {
  const rows: RenderGraphRow[] = [];
  let nextColor = nextColorStart;
  let maxLane = maxLaneStart;
  const color = () => nextColor++ % 12;
  const freeLane = () => {
    const index = lanes.findIndex((lane) => !lane);
    return index < 0 ? lanes.length : index;
  };

  for (let i = from; i < commits.length; i++) {
    const commit = commits[i]!;
    const reserved = lanes.findIndex((lane) => lane?.sha === commit.sha);
    const lane = reserved < 0 ? freeLane() : reserved;
    const refs = commit.refs.map((ref) =>
      ref.replace(/^(HEAD -> |tag: |refs\/heads\/|refs\/remotes\/|refs\/tags\/)/, ""),
    );
    const node = lanes[lane] ?? {
      sha: commit.sha,
      color: color(),
      label: refs.join(", ") || commit.shortSha,
    };
    const row: RenderGraphRow = {
      graph: { lane, color: node.color, edges: [] },
      incoming: reserved >= 0,
      edgeColors: [],
      laneLabels: {},
      nodeLabel: refs.join(", ") || commit.shortSha,
      hiddenParents: [],
    };
    lanes.forEach((entry, index) => {
      if (!entry) return;
      row.laneLabels[index] = entry.label;
      if (index !== lane) {
        row.graph.edges.push({ fromLane: index, toLane: index });
        row.edgeColors.push(entry.color);
      }
    });
    row.laneLabels[lane] = refs.join(", ") || node.label;
    lanes[lane] = undefined;

    const parents = options.firstParent ? commit.parents.slice(0, 1) : commit.parents;
    [...new Set(parents)].forEach((parent, index) => {
      // Message/author/path filters can omit every immediate parent. Do not
      // keep an unresolved lane through every later match: that creates a
      // growing wall of lines which falsely looks like parallel branches.
      // A short dotted endpoint denotes a parent outside the visible results.
      if (options.filtered && !visible.has(parent)) {
        row.hiddenParents.push(parent);
        return;
      }
      const existing = lanes.findIndex((entry) => entry?.sha === parent);
      const target = existing >= 0 ? existing : index === 0 ? lane : freeLane();
      const parentLane = lanes[target] ?? {
        sha: parent,
        color: index === 0 ? node.color : color(),
        label: index === 0 ? row.laneLabels[lane]! : parent.slice(0, 7),
      };
      lanes[target] = parentLane;
      row.graph.edges.push({ fromLane: lane, toLane: target });
      row.edgeColors.push(parentLane.color);
      row.laneLabels[target] ??= parentLane.label;
      maxLane = Math.max(maxLane, target);
    });
    maxLane = Math.max(maxLane, lane);
    while (lanes.length && !lanes.at(-1)) lanes.pop();
    rows.push(row);
  }
  return { rows, maxLane, nextColor, lanes };
}

function canResume(commits: readonly Commit[], cursor: GraphLayoutCursor, key: string) {
  if (cursor.optionsKey !== key) return false;
  // Filtered layouts depend on the full visible set; appending can promote a
  // previously-hidden parent into the window, so earlier rows must be rebuilt.
  if (key.startsWith("1:")) return false;
  if (cursor.length <= 0 || cursor.length > commits.length) return false;
  if (commits[0]?.sha !== cursor.headSha) return false;
  if (commits[cursor.length - 1]?.sha !== cursor.tailSha) return false;
  return true;
}

/** Layout the loaded history as one sequence, including page boundaries.
 * A pending parent has exactly one lane. Reserve parents immediately so an
 * octopus merge cannot assign several parents to the same empty lane.
 */
const emptyVisible = new Set<string>();

export function layoutCommitGraph(
  commits: readonly Commit[],
  options: GraphLayoutOptions = {},
): GraphLayoutResult {
  const visible = options.filtered ? new Set(commits.map((commit) => commit.sha)) : emptyVisible;
  const { rows, maxLane } = layoutRange(commits, 0, options, [], 0, 0, visible);
  return { rows, maxLane, colPx: colPxFor(maxLane) };
}

/**
 * Resume from a prior cursor when commits only grew by appending (loadMore).
 * Falls back to a full layout on filter/reset/prepend/reorder.
 */
export function layoutCommitGraphIncremental(
  commits: readonly Commit[],
  options: GraphLayoutOptions = {},
  previous: GraphLayoutCursor | null = null,
): { layout: GraphLayoutResult; cursor: GraphLayoutCursor } {
  const key = optionsKey(options);

  if (previous && canResume(commits, previous, key) && commits.length >= previous.length) {
    if (commits.length === previous.length) {
      return {
        layout: { rows: previous.rows, maxLane: previous.maxLane, colPx: colPxFor(previous.maxLane) },
        cursor: previous,
      };
    }
    // canResume rejects filtered layouts, so `visible` is unused on this path.
    const resumed = layoutRange(
      commits,
      previous.length,
      options,
      cloneLanes(previous.lanes),
      previous.nextColor,
      previous.maxLane,
      emptyVisible,
    );
    const rows = previous.rows.concat(resumed.rows);
    const cursor: GraphLayoutCursor = {
      optionsKey: key,
      length: commits.length,
      headSha: commits[0]?.sha ?? null,
      tailSha: commits.at(-1)?.sha ?? null,
      rows,
      maxLane: resumed.maxLane,
      lanes: resumed.lanes,
      nextColor: resumed.nextColor,
    };
    return { layout: { rows, maxLane: resumed.maxLane, colPx: colPxFor(resumed.maxLane) }, cursor };
  }

  // Only filtered layouts consult membership; skip the O(n) Set otherwise.
  const visible = options.filtered ? new Set(commits.map((commit) => commit.sha)) : emptyVisible;
  const full = layoutRange(commits, 0, options, [], 0, 0, visible);
  const cursor: GraphLayoutCursor = {
    optionsKey: key,
    length: commits.length,
    headSha: commits[0]?.sha ?? null,
    tailSha: commits.at(-1)?.sha ?? null,
    rows: full.rows,
    maxLane: full.maxLane,
    lanes: full.lanes,
    nextColor: full.nextColor,
  };
  return {
    layout: { rows: full.rows, maxLane: full.maxLane, colPx: colPxFor(full.maxLane) },
    cursor,
  };
}
