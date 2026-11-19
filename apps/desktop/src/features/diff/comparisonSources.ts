type ComparisonSources = {
  kind: "file" | "combined" | "compare";
  leftRev?: string;
  rightRev?: string;
};

function isFixedRevision(revision: string | undefined): boolean {
  // EMPTY is a case-sensitive backend sentinel. Short hashes and other revision
  // expressions may resolve differently later, so retain their live behavior.
  return revision === "EMPTY" || /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(revision ?? "");
}

/** Comparison tabs use explicit revisions; left/right are only display defaults. */
export function isLiveComparison(tab: ComparisonSources): boolean {
  return (
    tab.kind === "compare" && (!isFixedRevision(tab.leftRev) || !isFixedRevision(tab.rightRev))
  );
}
