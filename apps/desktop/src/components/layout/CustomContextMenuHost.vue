<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { getGroup, getAction, runAction, shortcutFor, isEnabled, isVisible } from "@/actions";
import type { ActionContext } from "@/actions";
import { resolveActionTitle } from "@/actions/titles";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { wasContextHandled } from "@/lib/contextMenu";
import { useRepositoryAction } from "@/composables/useRepositoryAction";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";

const { t } = useI18n();
const open = ref(false);
const x = ref(0);
const y = ref(0);
const workspace = useWorkspaceStore();
const changes = useChangesStore();

const captureRepository = useRepositoryAction(onClose);
let source: ReturnType<typeof captureRepository> | null = null;
const actionCtx = ref<ActionContext>({
  repoIds: [],
  selection: {},
  source: "context",
  place: "Git.ContextMenu.Changes",
});
watch(() => [changes.selectedSection, changes.stagingMode, ...changes.selectedPaths], onClose, {
  flush: "sync",
});

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

const estimatedHeight = computed(() => items.value.length * 28 + 16);

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
  source = captureRepository();
  if (!source.current()) return;
  actionCtx.value = {
    repoIds: source.repoId ? [source.repoId] : [],
    selection: { files: changes.selectedPaths.length ? [...changes.selectedPaths] : undefined },
    source: "context",
    place: "Git.ContextMenu.Changes",
    folderPath: workspace.folderPath,
  };
  open.value = true;
  x.value = e.clientX;
  y.value = e.clientY;
}

function onClose() {
  open.value = false;
}

async function pick(id: string, enabled: boolean) {
  if (!enabled || !open.value || !source?.current()) return;
  open.value = false;
  await runAction(id, actionCtx.value);
}

onMounted(() => {
  window.addEventListener("contextmenu", onContext);
  window.addEventListener("click", onClose);
});
onUnmounted(() => {
  window.removeEventListener("contextmenu", onContext);
  window.removeEventListener("click", onClose);
});
</script>

<template>
  <ContextMenuSurface
    :open="open"
    :anchor-x="x"
    :anchor-y="y"
    :width="240"
    :estimated-height="estimatedHeight"
    min-width-class="min-w-44"
    @close="onClose"
  >
    <button
      role="menuitem"
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
  </ContextMenuSurface>
</template>
