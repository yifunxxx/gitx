<script setup lang="ts">
import { getGroup, getAction, isEnabled, isVisible, runAction, shortcutFor } from "@/actions";
import type { ActionContext } from "@/actions";
import { resolveActionTitle } from "@/actions/titles";
import { useLayoutStore } from "@/stores/layoutStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import RecentProjectsMenuItems from "./RecentProjectsMenuItems.vue";

const { t } = useI18n();
const layout = useLayoutStore();
const workspace = useWorkspaceStore();
const showRecent = ref(false);
watch(
  () => layout.vcsPopupOpen,
  () => {
    showRecent.value = false;
  },
);

const group = computed(() => getGroup("Vcs.Operations.Popup"));
const items = computed(() =>
  (group.value?.children ?? [])
    .filter((c): c is string => c !== "-")
    .map((id) => getAction(id))
    .filter((a) => a && isVisible(a, ctx.value))
    .map((a) => ({
      id: a!.id,
      title: resolveActionTitle(a!, t),
      shortcut: shortcutFor(a!)[0],
      enabled: isEnabled(a!, ctx.value) === true,
    })),
);

const ctx = computed<ActionContext>(() => ({
  repoIds: workspace.toplevel ? [workspace.toplevel] : [],
  selection: {},
  source: "popup",
  place: "Vcs.Operations.Popup",
  folderPath: workspace.folderPath,
}));

async function pick(id: string) {
  layout.vcsPopupOpen = false;
  await runAction(id, ctx.value);
}
</script>

<template>
  <ContextMenuSurface
    :label="t('actions.vcsOperations')"
    :open="layout.vcsPopupOpen"
    :anchor-x="40"
    :anchor-y="48"
    :width="showRecent ? 360 : 280"
    :estimated-height="
      showRecent ? Math.min(20, workspace.recent.length) * 48 + 112 : items.length * 32 + 60
    "
    min-width-class="min-w-64"
    @close="layout.vcsPopupOpen = false"
  >
    <template v-if="showRecent">
      <button
        type="button"
        role="menuitem"
        class="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:bg-accent"
        @click="showRecent = false"
      >
        ← {{ t("toolbar.menu") }}
      </button>
      <RecentProjectsMenuItems @close="layout.vcsPopupOpen = false" />
    </template>
    <template v-else>
      <div class="px-2 py-1 text-[11px] font-medium text-muted-foreground">
        {{ t("actions.vcsOperations") }}
      </div>
      <button
        v-for="a in items"
        :key="a.id"
        type="button"
        role="menuitem"
        :disabled="!a.enabled"
        class="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-[13px] leading-4 hover:bg-accent focus-visible:bg-accent disabled:text-muted-foreground disabled:opacity-50"
        @click="pick(a.id)"
      >
        <span>{{ a.title }}</span>
        <kbd
          v-if="a.shortcut"
          class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
        >
          {{ a.shortcut }}
        </kbd>
      </button>
      <div role="separator" class="my-1 border-t" />
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px] hover:bg-accent focus-visible:bg-accent"
        @click="showRecent = true"
      >
        <span>{{ t("toolbar.recentProjects") }}</span
        ><span aria-hidden="true">›</span>
      </button>
    </template>
  </ContextMenuSurface>
</template>
