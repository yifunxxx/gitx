<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  getGroup,
  getAction,
  runAction,
  shortcutFor,
  isEnabled,
  isVisible,
} from "@/actions";
import type { ActionContext } from "@/actions";
import { resolveActionTitle } from "@/actions/titles";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { clampMenuPosition, wasContextHandled } from "@/lib/contextMenu";

const { t } = useI18n();
const open = ref(false);
const x = ref(0);
const y = ref(0);
const workspace = useWorkspaceStore();
const changes = useChangesStore();

const actionCtx = computed<ActionContext>(() => ({
  repoIds: workspace.toplevel ? [workspace.toplevel] : [],
  selection: {
    files: changes.selectedPaths.length ? [...changes.selectedPaths] : undefined,
  },
  source: "context",
  place: "Git.ContextMenu.Changes",
  folderPath: workspace.folderPath,
}));

const items = computed(() =>
  (getGroup("Git.ContextMenu.Changes")?.children ?? [])
    .filter((c): c is string => c !== "-")
    .map((id) => getAction(id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .filter((a) => isVisible(a, actionCtx.value))
    .map((a) => {
      const en = isEnabled(a, actionCtx.value);
      return {
        id: a.id,
        title: resolveActionTitle(a, t),
        shortcut: shortcutFor(a)[0],
        enabled: en === true,
        destructive: !!a.destructive,
      };
    }),
);

function onContext(e: MouseEvent) {
  // Always suppress native browser menu in the product chrome.
  e.preventDefault();
  if (wasContextHandled(e)) {
    open.value = false;
    return;
  }
  // Only surface the Changes group inside the Commit TW / changes surfaces.
  const target = e.target;
  if (!(target instanceof Element)) {
    open.value = false;
    return;
  }
  if (!target.closest('[data-gitx-context="changes"]')) {
    open.value = false;
    return;
  }
  // Local file-row menus already stopPropagation; this is empty chrome / headers.
  const pos = clampMenuPosition(e.clientX, e.clientY, 240, Math.min(420, items.value.length * 28 + 16));
  open.value = true;
  x.value = pos.x;
  y.value = pos.y;
}

function onClose() {
  open.value = false;
}

async function pick(id: string, enabled: boolean) {
  if (!enabled) return;
  open.value = false;
  await runAction(id, actionCtx.value);
}

function onKey(ev: KeyboardEvent) {
  if (ev.key === "Escape") onClose();
}

onMounted(() => {
  window.addEventListener("contextmenu", onContext);
  window.addEventListener("click", onClose);
  window.addEventListener("keydown", onKey);
});
onUnmounted(() => {
  window.removeEventListener("contextmenu", onContext);
  window.removeEventListener("click", onClose);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-[9998]"
      @click="onClose"
      @contextmenu.prevent="onClose"
    >
      <div
        class="absolute z-[9999] min-w-44 rounded-md border bg-popover p-1 shadow-lg ring-1 ring-foreground/10"
        :style="{ left: `${x}px`, top: `${y}px` }"
        @click.stop
      >
        <button
          v-for="a in items"
          :key="a.id"
          type="button"
          class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] leading-4"
          :class="
            a.enabled
              ? a.destructive
                ? 'text-destructive hover:bg-accent'
                : 'hover:bg-accent'
              : 'cursor-default text-muted-foreground/60'
          "
          :disabled="!a.enabled"
          @click="pick(a.id, a.enabled)"
        >
          <span>{{ a.title }}</span>
          <kbd
            v-if="a.shortcut"
            class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {{ a.shortcut }}
          </kbd>
        </button>
      </div>
    </div>
  </Teleport>
</template>
