type AddSelection = {
  unversioned: readonly { path: string }[];
  selectedPaths: readonly string[];
  selectedSection: string | null;
  checkedPaths: readonly string[];
  stagingMode: boolean;
};

// Add alone accepts commit checkboxes; other context-menu actions still use row selection.
export function addToVcsPaths(changes: AddSelection, contextPath?: string): string[] {
  const available = new Set(changes.unversioned.map((file) => file.path));
  const valid = (paths: readonly string[]) => [
    ...new Set(paths.filter((path) => available.has(path))),
  ];
  const checked = changes.stagingMode ? [] : valid(changes.checkedPaths);
  const selected = changes.selectedSection === "unversioned" ? valid(changes.selectedPaths) : [];

  if (contextPath !== undefined) {
    if (!available.has(contextPath)) return [];
    if (selected.length > 1 && selected.includes(contextPath)) return selected;
    return checked.includes(contextPath) ? checked : [contextPath];
  }

  if (selected.length > 1) return selected;
  if (selected.length === 1 && !checked.includes(selected[0]!)) return selected;
  return checked;
}
