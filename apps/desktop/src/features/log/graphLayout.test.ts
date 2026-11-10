import { describe, expect, it } from "vitest";
import { layoutCommitGraph, layoutCommitGraphIncremental } from "./graphLayout";

const c = (sha: string, ...parents: string[]) => ({ sha, shortSha: sha, parents, refs: [] });

// Trace the rendered strokes to actual commit nodes. This checks connectivity,
// independently of which lane allocation strategy produced the drawing.
function drawnParents(commits: ReturnType<typeof c>[], filtered = false) {
  const { rows } = layoutCommitGraph(commits, { filtered });
  return rows.map((row, index) => {
    return row.graph.edges
      .filter((edge) => edge.fromLane === row.graph.lane)
      .map((edge) => {
        let lane = edge.toLane;
        for (let next = index + 1; next < rows.length; next++) {
          const nextRow = rows[next]!;
          if (nextRow.graph.lane === lane) return commits[next]!.sha;
          const continued = nextRow.graph.edges.filter((line) => line.fromLane === lane);
          expect(continued, `broken or forked stroke below ${commits[index]!.sha}`).toHaveLength(1);
          lane = continued[0]!.toLane;
        }
        throw new Error(`stroke from ${commits[index]!.sha} never reached a visible parent`);
      })
      .sort();
  });
}

describe("commit graph topology", () => {
  it("draws every parent connection across criss-cross and octopus merges", () => {
    const commits = [
      c("octopus", "cross-left", "cross-right", "orphan", "side-a", "side-b", "side-c"),
      c("cross-left", "a", "b"),
      c("cross-right", "b", "a"),
      c("orphan"),
      c("side-a", "root"),
      c("side-b", "root"),
      c("side-c", "root"),
      c("a", "root"),
      c("b", "root"),
      c("root"),
    ];
    expect(drawnParents(commits)).toEqual(commits.map((commit) => [...commit.parents].sort()));
  });

  it("preserves exact connectivity in a dense deterministic DAG and its filtered view", () => {
    let seed = 913;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const commits = Array.from({ length: 240 }, (_, index) => {
      const parents = index && index % 37 ? [index - 1] : [];
      if (index > 4 && index % 3 === 0) parents.push(next() % index, next() % index);
      if (index > 12 && index % 11 === 0) parents.push(next() % index, next() % index);
      return c(`node-${index}`, ...[...new Set(parents)].map((parent) => `node-${parent}`));
    }).reverse();
    expect(drawnParents(commits)).toEqual(commits.map((commit) => [...commit.parents].sort()));
    const filtered = commits.filter((_, index) => index % 4 !== 1);
    const visible = new Set(filtered.map((commit) => commit.sha));
    expect(drawnParents(filtered, true)).toEqual(
      filtered.map((commit) => commit.parents.filter((parent) => visible.has(parent)).sort()),
    );
    expect(layoutCommitGraph(commits).rows.slice(0, 97)).toEqual(
      layoutCommitGraph(commits.slice(0, 97)).rows,
    );
  });

  it("does not reserve phantom lanes for parents hidden by a filter", () => {
    const commits = Array.from({ length: 200 }, (_, i) => c(`match-${i}`, `hidden-${i}`));
    const { rows, maxLane } = layoutCommitGraph(commits, { filtered: true });
    expect(maxLane).toBe(0);
    expect(rows.every((row) => !row.incoming && row.graph.edges.length === 0)).toBe(true);
    expect(rows[199]!.hiddenParents).toEqual(["hidden-199"]);
  });

  it("retains real connections between matching commits", () => {
    const { rows } = layoutCommitGraph([c("a", "b", "hidden"), c("b")], { filtered: true });
    expect(rows[0]!.graph.edges).toEqual([{ fromLane: 0, toLane: 0 }]);
    expect(rows[0]!.hiddenParents).toEqual(["hidden"]);
    expect(rows[1]!.incoming).toBe(true);
  });

  it("only follows the mainline in first-parent mode", () => {
    const { rows, maxLane } = layoutCommitGraph(
      [c("merge", "main", "side"), c("main", "root"), c("root")],
      { firstParent: true },
    );
    expect(maxLane).toBe(0);
    expect(rows[0]!.graph.edges).toEqual([{ fromLane: 0, toLane: 0 }]);
    expect(rows[2]!.graph.edges).toEqual([]);
  });
  it("joins shared first parents without leaving a phantom spine", () => {
    const { rows } = layoutCommitGraph([c("m", "a", "b"), c("a", "r"), c("b", "r"), c("r")]);
    expect(rows.map((row) => row.graph.lane)).toEqual([0, 0, 1, 0]);
    expect(rows[2]!.graph.edges).toContainEqual({ fromLane: 1, toLane: 0 });
    expect(rows[3]!.graph.edges).toEqual([]);
    expect(rows[3]!.incoming).toBe(true);
  });

  it("reserves distinct lanes immediately for an octopus merge", () => {
    const { rows } = layoutCommitGraph([
      c("m", "a", "b", "c"),
      c("a", "r"),
      c("b", "r"),
      c("c", "r"),
      c("r"),
    ]);
    expect(rows[0]!.graph.edges.map((edge) => edge.toLane)).toEqual([0, 1, 2]);
    expect(rows.at(-1)!.graph.edges).toEqual([]);
  });

  it("keeps branch color on fork, spine, node and join", () => {
    const { rows } = layoutCommitGraph([c("m", "a", "b"), c("a", "r"), c("b", "r"), c("r")]);
    expect(rows[0]!.edgeColors[1]).toBe(rows[2]!.graph.color);
    expect(rows[1]!.edgeColors[0]).toBe(rows[2]!.graph.color);
    expect(rows[2]!.edgeColors[1]).toBe(rows[3]!.graph.color);
  });

  it("preserves all existing rows when the next page arrives", () => {
    const commits = [
      c("merge", "a0", "b"),
      ...Array.from({ length: 120 }, (_, i) => c(`a${i}`, i < 119 ? `a${i + 1}` : "root")),
      c("b", "root"),
      c("root"),
    ];
    const first = layoutCommitGraph(commits.slice(0, 100));
    const all = layoutCommitGraph(commits);
    expect(all.rows.slice(0, 100)).toEqual(first.rows);
    expect(all.rows[100]!.incoming).toBe(true);
    expect(all.rows.at(-1)!.graph.edges).toEqual([]);
  });

  it("reuses finished lanes without borrowing their labels or incoming line", () => {
    const { rows } = layoutCommitGraph([
      { ...c("a"), refs: ["first"] },
      { ...c("b"), refs: ["second"] },
    ]);
    expect(rows[1]!.incoming).toBe(false);
    expect(rows[1]!.laneLabels[0]).toBe("second");
    expect(rows[1]!.graph.color).not.toBe(rows[0]!.graph.color);
  });

  it("keeps a long linear history in one lane", () => {
    const commits = Array.from({ length: 10000 }, (_, i) =>
      c(`${i}`, ...(i < 9999 ? [`${i + 1}`] : [])),
    );
    const result = layoutCommitGraph(commits);
    expect(result.maxLane).toBe(0);
    expect(result.rows).toHaveLength(10000);
    expect(result.rows.at(-1)!.graph.edges).toEqual([]);
  });

  it("resumes layout on append without rebuilding the prefix", () => {
    const commits = Array.from({ length: 250 }, (_, i) =>
      c(`n${i}`, ...(i < 249 ? [`n${i + 1}`] : [])),
    );
    const first = layoutCommitGraphIncremental(commits.slice(0, 100));
    const second = layoutCommitGraphIncremental(commits.slice(0, 200), {}, first.cursor);
    const full = layoutCommitGraph(commits.slice(0, 200));
    expect(second.layout.rows).toEqual(full.rows);
    expect(second.cursor.length).toBe(200);
    expect(second.layout.rows.slice(0, 100)).toEqual(first.layout.rows);
  });

  it("does not resume a filtered layout after append", () => {
    const commits = [c("a", "hidden-a"), c("b", "hidden-b"), c("c", "hidden-c")];
    const first = layoutCommitGraphIncremental(commits.slice(0, 2), { filtered: true });
    const second = layoutCommitGraphIncremental(commits, { filtered: true }, first.cursor);
    expect(second.layout.rows).toEqual(layoutCommitGraph(commits, { filtered: true }).rows);
    expect(second.cursor).not.toBe(first.cursor);
  });
});
