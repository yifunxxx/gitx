import type { LogCommit } from "@/lib/backend";

export type LogTreeRow =
  | { kind: "branch"; key: string; name: string }
  | { kind: "commit"; key: string; commit: LogCommit; flatIndex: number; depth: number };

function refLabel(ref: string) {
  return ref.replace(/^(HEAD -> |tag: |refs\/heads\/|refs\/remotes\/|refs\/tags\/)/, "");
}

/**
 * Branch-oriented commit tree (IDEA / SourceTree style):
 * one section per tip ref, first-parent chain until a commit already shown.
 * Remaining loaded commits append under an "Other" bucket so nothing disappears.
 */
export function buildLogTreeRows(commits: readonly LogCommit[], otherLabel = "Other"): LogTreeRow[] {
  const bySha = new Map(commits.map((commit, flatIndex) => [commit.sha, { commit, flatIndex }]));
  const seen = new Set<string>();
  const rows: LogTreeRow[] = [];
  const tips: { name: string; sha: string }[] = [];
  const tipNames = new Set<string>();

  for (const commit of commits) {
    for (const ref of commit.refs) {
      if (ref.startsWith("tag:")) continue;
      const name = refLabel(ref);
      if (!name || tipNames.has(name)) continue;
      tipNames.add(name);
      tips.push({ name, sha: commit.sha });
    }
  }

  for (const tip of tips) {
    rows.push({ kind: "branch", key: `branch:${tip.name}`, name: tip.name });
    let sha: string | undefined = tip.sha;
    while (sha) {
      const hit = bySha.get(sha);
      if (!hit || seen.has(sha)) break;
      seen.add(sha);
      rows.push({
        kind: "commit",
        key: `commit:${sha}`,
        commit: hit.commit,
        flatIndex: hit.flatIndex,
        depth: 1,
      });
      sha = hit.commit.parents[0];
    }
  }

  let otherOpened = false;
  for (const commit of commits) {
    if (seen.has(commit.sha)) continue;
    if (!otherOpened) {
      rows.push({ kind: "branch", key: "branch:__other__", name: otherLabel });
      otherOpened = true;
    }
    const flatIndex = bySha.get(commit.sha)!.flatIndex;
    seen.add(commit.sha);
    rows.push({
      kind: "commit",
      key: `commit:${commit.sha}`,
      commit,
      flatIndex,
      depth: otherOpened ? 1 : 0,
    });
  }

  return rows;
}

export function logTreeRowKey(row: LogTreeRow) {
  return row.key;
}
