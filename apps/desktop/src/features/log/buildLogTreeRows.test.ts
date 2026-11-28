import { describe, expect, it } from "vitest";
import { buildLogTreeRows } from "./buildLogTreeRows";
import type { LogCommit } from "@/lib/backend";

const commit = (sha: string, parents: string[] = [], refs: string[] = []): LogCommit => ({
  sha,
  shortSha: sha,
  parents,
  refs,
  subject: sha,
  author: "A",
  authorEmail: "a@b.c",
  authorTime: 0,
  graph: { lane: 0, edges: [], color: 0 },
});

describe("buildLogTreeRows", () => {
  it("groups first-parent chains under branch tips and keeps leftovers", () => {
    const commits = [
      commit("f1", ["shared"], ["feature"]),
      commit("m1", ["shared"], ["HEAD -> main", "main"]),
      commit("shared", ["root"]),
      commit("orphan"),
      commit("root"),
    ];
    const rows = buildLogTreeRows(commits, "Other");
    expect(rows.filter((row) => row.kind === "branch").map((row) => row.name)).toEqual([
      "feature",
      "main",
      "Other",
    ]);
    expect(
      rows
        .filter((row) => row.kind === "commit")
        .map((row) => (row.kind === "commit" ? row.commit.sha : "")),
    ).toEqual(["f1", "shared", "root", "m1", "orphan"]);
  });

  it("emits a stable key per row", () => {
    const rows = buildLogTreeRows([commit("a", [], ["main"])], "Other");
    expect(rows.map((row) => row.key)).toEqual(["branch:main", "commit:a"]);
  });

  it("keeps branch identities distinct from the fallback group, even with matching names", () => {
    const commits = [commit("tip", [], ["HEAD -> __other__", "__other__"]), commit("merged-side")];
    const rows = buildLogTreeRows(commits, "__other__");
    expect(rows.filter((row) => row.kind === "branch").map((row) => row.name)).toEqual([
      "__other__",
      "__other__",
    ]);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(rows.filter((row) => row.kind === "commit").map((row) => row.commit.sha)).toEqual([
      "tip",
      "merged-side",
    ]);
    expect(buildLogTreeRows(commits, "其他提交").map((row) => row.key)).toEqual(
      rows.map((row) => row.key),
    );
  });
});
