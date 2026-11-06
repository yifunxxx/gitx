import { defineStore } from "pinia";
import { ref, watch } from "vue";

const KEY = "gitx.layout.v1";

export const useLayoutStore = defineStore("layout", () => {
  const leftOpen = ref(true);
  const bottomOpen = ref(true);
  const leftSize = ref(28);
  const bottomSize = ref(32);
  const activeBottomTab = ref<
    "console" | "log" | "update" | "stash" | "shelf" | "stashesShelves"
  >("log");
  const activeEditorKind = ref<
    "welcome" | "diff" | "history" | "compare" | "repoAtRev" | "blame" | "merge" | "file"
  >("welcome");
  const findActionOpen = ref(false);
  const vcsPopupOpen = ref(false);

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Record<string, unknown>;
      if (typeof data.leftOpen === "boolean") leftOpen.value = data.leftOpen;
      if (typeof data.bottomOpen === "boolean") bottomOpen.value = data.bottomOpen;
      if (typeof data.leftSize === "number") leftSize.value = data.leftSize;
      if (typeof data.bottomSize === "number") bottomSize.value = data.bottomSize;
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
      }),
    );
  }

  load();
  watch([leftOpen, bottomOpen, leftSize, bottomSize], persist);

  return {
    leftOpen,
    bottomOpen,
    leftSize,
    bottomSize,
    activeBottomTab,
    activeEditorKind,
    findActionOpen,
    vcsPopupOpen,
  };
});
