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

/** Layout the loaded history as one sequence, including page boundaries.
 * A pending parent has exactly one lane. Reserve parents immediately so an
 * octopus merge cannot assign several parents to the same empty lane.
 */
export function layoutCommitGraph(
  commits: readonly Commit[],
  options: { filtered?: boolean; firstParent?: boolean } = {},
) {
  const visible = new Set(commits.map((commit) => commit.sha));
  const lanes: Array<Lane | undefined> = [];
  let nextColor = 0;
  let maxLane = 0;
  const color = () => nextColor++ % 12;
  const freeLane = () => {
    const index = lanes.findIndex((lane) => !lane);
    return index < 0 ? lanes.length : index;
  };
  const rows: RenderGraphRow[] = [];

  for (const commit of commits) {
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
  return { rows, maxLane, colPx: Math.max(48, (maxLane + 1) * 14 + 12) };
}
