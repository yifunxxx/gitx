import { defineStore } from "pinia";
import { ref, watch } from "vue";
import type { CommitTwMode } from "@/lib/backend";
import { getBackend } from "@/lib/backend";

const KEY = "gitx.layout.v1";

export const useLayoutStore = defineStore("layout", () => {
  const leftOpen = ref(true);
  const bottomOpen = ref(true);
  const leftSize = ref(28);
  const bottomSize = ref(32);
  const activeBottomTab = ref<
    "console" | "log" | "update" | "stash" | "shelf" | "stashesShelves" | "worktrees"
  >("log");
  const activeEditorKind = ref<
    "welcome" | "diff" | "history" | "compare" | "repoAtRev" | "blame" | "merge" | "file"
  >("welcome");
  const findActionOpen = ref(false);
  const vcsPopupOpen = ref(false);
  /** Commit TW presentation (#69). */
  const commitTwMode = ref<CommitTwMode>("docked");
  const commitControlsHidden = ref(false);

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data.leftOpen === "boolean") leftOpen.value = data.leftOpen;
      if (typeof data.bottomOpen === "boolean") bottomOpen.value = data.bottomOpen;
      if (typeof data.leftSize === "number") leftSize.value = data.leftSize;
      if (typeof data.bottomSize === "number") bottomSize.value = data.bottomSize;
      if (data.commitTwMode === "docked" || data.commitTwMode === "window" || data.commitTwMode === "float") {
        commitTwMode.value = data.commitTwMode;
      }
      if (typeof data.commitControlsHidden === "boolean") {
        commitControlsHidden.value = data.commitControlsHidden;
      }
    } catch {
      /* ignore */
    }
  }

  function persist() {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        leftOpen: leftOpen.value,
        bottomOpen: bottomOpen.value,
        leftSize: leftSize.value,
        bottomSize: bottomSize.value,
        commitTwMode: commitTwMode.value,
        commitControlsHidden: commitControlsHidden.value,
      }),
    );
  }

  load();
  // Keep dock visibility consistent with Commit TW presentation after restore.
  if (commitTwMode.value === "float") {
    leftOpen.value = false;
  } else if (!leftOpen.value) {
    leftOpen.value = true;
  }
  watch(
    [leftOpen, bottomOpen, leftSize, bottomSize, commitTwMode, commitControlsHidden],
    persist,
  );

  async function setCommitTwMode(mode: CommitTwMode) {
    const prev = commitTwMode.value;
    commitTwMode.value = mode;
    // IDEA-like single OS window: modes are in-app only (never spawn WebviewWindow).
    if (mode === "docked") {
      leftOpen.value = true;
      if (leftSize.value > 40) leftSize.value = 28;
    } else if (mode === "window") {
      // "Window" = undocked-style wide dock inside the main frame (no OS window).
      leftOpen.value = true;
      if (leftSize.value < 36) leftSize.value = 42;
    } else if (mode === "float") {
      // Float = in-app floating panel; hide the docked left slot.
      leftOpen.value = false;
    }
    try {
      await getBackend().uiSyncBroadcast({
        channel: "commitTw.mode",
        data: { mode, previous: prev },
      });
    } catch {
      /* web */
    }
  }

  function toggleCommitControls() {
    commitControlsHidden.value = !commitControlsHidden.value;
  }

  return {
    leftOpen,
    bottomOpen,
    leftSize,
    bottomSize,
    activeBottomTab,
    activeEditorKind,
    findActionOpen,
    vcsPopupOpen,
    commitTwMode,
    commitControlsHidden,
    setCommitTwMode,
    toggleCommitControls,
  };
});
