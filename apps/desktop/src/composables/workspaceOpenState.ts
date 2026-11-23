import { ref, shallowRef } from "vue";
import type { useWorkspaceStore } from "@/stores/workspaceStore";

type Workspace = ReturnType<typeof useWorkspaceStore>;
type OpenOperation = { id: symbol; navigation: number; path: string | null };
const states = new WeakMap<Workspace, ReturnType<typeof createState>>();
function createState() {
  return { operation: shallowRef<OpenOperation | null>(null), error: ref<string | null>(null) };
}

// Share ownership within one workspace without retaining closed Pinia instances.
export function workspaceOpenState(workspace: Workspace) {
  let state = states.get(workspace);
  if (!state) {
    state = createState();
    states.set(workspace, state);
  }
  return state;
}

// Rendering predicates only inspect existing state; they never initialize stores.
export function isWorkspaceOpening(workspace: Workspace) {
  const operation = states.get(workspace)?.operation.value;
  return !!operation && operation.navigation === workspace.navigationToken();
}

/** Mounted panels share the controller's reads only after its open result is
 * published. A pending picker or failed backend must not suppress reads for
 * the repository that is still displayed; root switches also retire ownership. */
export function ownsWorkspaceInitialReads(workspace: Workspace) {
  const operation = states.get(workspace)?.operation.value;
  return !!operation && operation.path !== null &&
    operation.navigation === workspace.navigationToken() &&
    operation.navigation === workspace.appliedOpenToken();
}
