import { defineStore } from "pinia";
import { ref, watch } from "vue";
import type { CommitTwMode } from "@/lib/backend";
import { getBackend } from "@/lib/backend";

const KEY = "gitx.layout.v1";

export const useLayoutStore = defineStore("layout", () => {
  const leftOpen = ref(true);
  const activeLeftTab = ref<"commit" | "file">("commit");
  const bottomOpen = ref(true);
  const bottomMaximized = ref(false);
  const leftSize = ref(28);
  const bottomSize = ref(32);
  const activeBottomTab = ref<
    "console" | "log" | "update" | "stash" | "shelf" | "stashesShelves" | "worktrees" | "terminal"
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
      if (data.activeLeftTab === "commit" || data.activeLeftTab === "file") {
        activeLeftTab.value = data.activeLeftTab;
      }
      if (typeof data.bottomOpen === "boolean") bottomOpen.value = data.bottomOpen;
      if (typeof data.leftSize === "number") leftSize.value = data.leftSize;
      if (typeof data.bottomSize === "number") bottomSize.value = data.bottomSize;
      if (
        data.commitTwMode === "docked" ||
        data.commitTwMode === "window" ||
        data.commitTwMode === "float"
      ) {
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
        activeLeftTab: activeLeftTab.value,
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
  if (activeLeftTab.value === "commit" && commitTwMode.value === "float") {
    leftOpen.value = false;
  } else if (activeLeftTab.value === "commit" && !leftOpen.value) {
    leftOpen.value = true;
  }
  watch(
    [leftOpen, activeLeftTab, bottomOpen, leftSize, bottomSize, commitTwMode, commitControlsHidden],
    persist,
  );

  function showLeftTab(tab: "commit" | "file") {
    activeLeftTab.value = tab;
    leftOpen.value = tab === "file" || commitTwMode.value !== "float";
  }

  function toggleLeftTab(tab: "commit" | "file") {
    if (activeLeftTab.value === tab && leftOpen.value) leftOpen.value = false;
    else showLeftTab(tab);
  }

  async function setCommitTwMode(mode: CommitTwMode) {
    const prev = commitTwMode.value;
    activeLeftTab.value = "commit";
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
    activeLeftTab,
    bottomOpen,
    bottomMaximized,
    leftSize,
    bottomSize,
    activeBottomTab,
    activeEditorKind,
    findActionOpen,
    vcsPopupOpen,
    commitTwMode,
    commitControlsHidden,
    setCommitTwMode,
    showLeftTab,
    toggleLeftTab,
    toggleCommitControls,
  };
});
