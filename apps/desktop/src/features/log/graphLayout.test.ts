import { describe, expect, it } from "vitest";
import {
  layoutCommitGraph,
  layoutCommitGraphIncremental,
  type GraphLayoutResult,
} from "./graphLayout";

const c = (sha: string, ...parents: string[]) => ({ sha, shortSha: sha, parents, refs: [] });

// Trace the rendered strokes to actual commit nodes. This checks connectivity,
// independently of which lane allocation strategy produced the drawing.
function drawnParents(
  commits: ReturnType<typeof c>[],
  filtered = false,
  layout: GraphLayoutResult = layoutCommitGraph(commits, { filtered }),
) {
  const { rows } = layout;
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

describe("incremental graph invalidation", () => {
  const branched = () => [
    c("merge", "a1", "b1"),
    c("a1", "a0"),
    c("b1", "b0"),
    c("a0", "root"),
    c("b0", "root"),
    c("root"),
  ];

  it.each([false, true])(
    "redraws a legal interior topological reorder (in-place=%s)",
    (inPlace) => {
      const commits = branched();
      const first = layoutCommitGraphIncremental(commits);
      const reordered = [
        commits[0]!,
        commits[2]!,
        commits[4]!,
        commits[1]!,
        commits[3]!,
        commits[5]!,
      ];
      const next = inPlace ? commits : reordered;
      if (inPlace) commits.splice(0, commits.length, ...reordered);
      const actual = layoutCommitGraphIncremental(next, {}, first.cursor).layout;
      expect(drawnParents(next, false, actual)).toEqual(
        next.map((commit) => [...commit.parents].sort()),
      );
      expect(actual).toEqual(layoutCommitGraph(next));
    },
  );

  it.each([false, true])(
    "refreshes renamed refs and inherited lane labels (in-place=%s)",
    (inPlace) => {
      const commits = [
        { ...c("head", "middle"), refs: ["refs/heads/old-name"] },
        c("middle", "root"),
        c("root"),
      ];
      const first = layoutCommitGraphIncremental(commits.slice(0, 2));
      const next = inPlace
        ? commits
        : [{ ...commits[0]!, refs: ["refs/heads/new-name"] }, ...commits.slice(1)];
      if (inPlace) commits[0]!.refs.splice(0, 1, "refs/heads/new-name");
      const actual = layoutCommitGraphIncremental(next, {}, first.cursor).layout;
      expect(actual.rows[0]!.nodeLabel).toBe("new-name");
      expect(actual.rows[1]!.laneLabels[0]).toBe("new-name");
      expect(actual.rows[2]!.laneLabels[0]).toBe("new-name");
      expect(actual).toEqual(layoutCommitGraph(next));
      // Cached input must not alias the caller's original mutable refs.
      expect(first.layout.rows[0]!.nodeLabel).toBe("old-name");
    },
  );

  it("refreshes ref add/remove and order changes on interior rows", () => {
    const commits = branched().map((commit) => ({ ...commit, refs: [] as string[] }));
    let prior = layoutCommitGraphIncremental(commits);
    for (const refs of [["refs/heads/topic", "tag: v1"], ["tag: v1", "refs/heads/topic"], []]) {
      commits[2]!.refs.splice(0, commits[2]!.refs.length, ...refs);
      const actual = layoutCommitGraphIncremental(commits, {}, prior.cursor);
      expect(actual.layout).toEqual(layoutCommitGraph(commits));
      expect(actual.cursor).not.toBe(prior.cursor);
      prior = actual;
    }
  });

  it("detects changed parent arrays even when commit objects and outer array are reused", () => {
    const commits = branched();
    const first = layoutCommitGraphIncremental(commits);
    commits[0]!.parents.reverse();
    commits[1]!.parents.splice(0, 1, "root");
    const actual = layoutCommitGraphIncremental(commits, {}, first.cursor).layout;
    expect(drawnParents(commits, false, actual)).toEqual(
      commits.map((commit) => [...commit.parents].sort()),
    );
    expect(actual).toEqual(layoutCommitGraph(commits));
  });

  it("updates a changed short SHA label without relying on commit identity", () => {
    const commits = [c("head", "root"), c("root")];
    const first = layoutCommitGraphIncremental(commits);
    commits[0]!.shortSha = "longer-short-sha";
    const actual = layoutCommitGraphIncremental(commits, {}, first.cursor).layout;
    expect(actual.rows[0]!.nodeLabel).toBe("longer-short-sha");
    expect(actual.rows[1]!.laneLabels[0]).toBe("longer-short-sha");
    expect(actual).toEqual(layoutCommitGraph(commits));
  });

  it("checks the full prior prefix when reordering and appending together", () => {
    const commits = branched();
    const first = layoutCommitGraphIncremental(commits.slice(0, 5));
    const next = [commits[0]!, commits[2]!, commits[1]!, commits[3]!, commits[4]!, commits[5]!];
    const actual = layoutCommitGraphIncremental(next, {}, first.cursor).layout;
    expect(drawnParents(next, false, actual)).toEqual(
      next.map((commit) => [...commit.parents].sort()),
    );
    expect(actual).toEqual(layoutCommitGraph(next));
  });

  it("reuses all rows for an equivalent refresh and only allocates appended graph rows", () => {
    const commits = branched();
    const first = layoutCommitGraphIncremental(commits.slice(0, 3));
    const equivalent = commits.slice(0, 3).map((commit) => ({
      ...commit,
      parents: [...commit.parents],
      refs: [...commit.refs],
      subject: "a field not used by the graph",
    }));
    const unchanged = layoutCommitGraphIncremental(equivalent, {}, first.cursor);
    expect(unchanged.cursor).toBe(first.cursor);
    expect(unchanged.layout.rows).toBe(first.layout.rows);
    const appended = layoutCommitGraphIncremental(
      [...equivalent, ...commits.slice(3)],
      {},
      first.cursor,
    );
    expect(appended.layout).toEqual(layoutCommitGraph(commits));
    for (let i = 0; i < first.layout.rows.length; i++) {
      expect(appended.layout.rows[i]).toBe(first.layout.rows[i]);
    }
  });

  it("supports in-place append without losing the prefix object reuse", () => {
    const commits = branched();
    const loaded = commits.slice(0, 3);
    const first = layoutCommitGraphIncremental(loaded);
    loaded.push(...commits.slice(3));
    const actual = layoutCommitGraphIncremental(loaded, {}, first.cursor);
    expect(actual.layout).toEqual(layoutCommitGraph(commits));
    expect(actual.layout.rows[0]).toBe(first.layout.rows[0]);
    expect(actual.layout.rows[2]).toBe(first.layout.rows[2]);
    expect(first.cursor.length).toBe(3);
  });

  it("invalidates changed options, shortened windows and prepended commits", () => {
    const commits = branched();
    const first = layoutCommitGraphIncremental(commits);
    const firstParent = layoutCommitGraphIncremental(commits, { firstParent: true }, first.cursor);
    expect(firstParent.layout).toEqual(layoutCommitGraph(commits, { firstParent: true }));
    expect(firstParent.layout.rows[0]).not.toBe(first.layout.rows[0]);
    for (const next of [commits.slice(0, 3), [c("new-head", "merge"), ...commits], []]) {
      expect(layoutCommitGraphIncremental(next, {}, first.cursor).layout).toEqual(
        layoutCommitGraph(next),
      );
    }
  });

  it("reuses an unchanged filtered window but redraws when append reveals a hidden parent", () => {
    const commits = [c("merge", "a", "b"), c("a", "root"), c("b", "root"), c("root")];
    const options = { filtered: true };
    const first = layoutCommitGraphIncremental(commits.slice(0, 2), options);
    const unchanged = layoutCommitGraphIncremental(commits.slice(0, 2), options, first.cursor);
    expect(unchanged.cursor).toBe(first.cursor);
    expect(unchanged.layout.rows).toBe(first.layout.rows);
    expect(first.layout.rows[0]!.hiddenParents).toEqual(["b"]);
    const appended = layoutCommitGraphIncremental(commits, options, first.cursor);
    expect(appended.layout).toEqual(layoutCommitGraph(commits, options));
    expect(appended.layout.rows[0]!.hiddenParents).toEqual([]);
    expect(drawnParents(commits, true, appended.layout)).toEqual(
      commits.map((commit) => [...commit.parents].sort()),
    );
  });

  it("reuses an empty refresh and accepts its first page", () => {
    const empty = layoutCommitGraphIncremental([]);
    expect(layoutCommitGraphIncremental([], {}, empty.cursor).cursor).toBe(empty.cursor);
    const commits = branched();
    expect(layoutCommitGraphIncremental(commits, {}, empty.cursor).layout).toEqual(
      layoutCommitGraph(commits),
    );
  });
});
