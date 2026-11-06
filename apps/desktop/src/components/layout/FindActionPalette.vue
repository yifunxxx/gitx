<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { searchActions, runAction, shortcutFor } from "@/actions";
import type { ActionContext } from "@/actions";
import { resolveActionTitle } from "@/actions/titles";
import { useLayoutStore } from "@/stores/layoutStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const { t } = useI18n();
const layout = useLayoutStore();
const workspace = useWorkspaceStore();
const query = ref("");
const inputEl = ref<HTMLInputElement | null>(null);

const ctx = computed<ActionContext>(() => ({
  repoIds: workspace.toplevel ? [workspace.toplevel] : [],
  selection: {},
  source: "palette",
  place: "FindAction",
  folderPath: workspace.folderPath,
}));

const results = computed(() =>
  searchActions(query.value, ctx.value)
    .slice(0, 30)
    .map((a) => ({
      id: a.id,
      title: resolveActionTitle(a, t),
      shortcut: shortcutFor(a)[0],
    })),
);

watch(
  () => layout.findActionOpen,
  (open) => {
    if (open) {
      query.value = "";
      requestAnimationFrame(() => inputEl.value?.focus());
    }
  },
);

async function pick(id: string) {
  layout.findActionOpen = false;
  await runAction(id, ctx.value);
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") layout.findActionOpen = false;
}
</script>

<template>
  <div
    v-if="layout.findActionOpen"
    class="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[12vh]"
    @click.self="layout.findActionOpen = false"
    @keydown="onKey"
  >
    <div class="w-full max-w-lg overflow-hidden rounded-lg border bg-popover shadow-lg">
      <input
        ref="inputEl"
        v-model="query"
        class="h-10 w-full border-b bg-transparent px-3 text-sm outline-none"
        :placeholder="t('actions.findAction')"
      />
      <ul class="max-h-80 overflow-auto p-1">
        <li v-for="a in results" :key="a.id">
          <button
            type="button"
            class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
            @click="pick(a.id)"
          >
            <span>
              <span class="font-medium">{{ a.title }}</span>
              <span class="ml-2 text-xs text-muted-foreground">{{ a.id }}</span>
            </span>
            <kbd
              v-if="a.shortcut"
              class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
            >
              {{ a.shortcut }}
            </kbd>
          </button>
        </li>
        <li v-if="!results.length" class="px-2 py-3 text-xs text-muted-foreground">
          {{ t("actions.noActions") }}
        </li>
      </ul>
    </div>
  </div>
</template>
