<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { searchActions, runAction, shortcutFor, isEnabled } from "@/actions";
import type { ActionContext } from "@/actions";
import { resolveActionTitle } from "@/actions/titles";
import { useLayoutStore } from "@/stores/layoutStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";

const { t } = useI18n();
const layout = useLayoutStore();
const workspace = useWorkspaceStore();
const query = ref("");
const inputEl = ref<HTMLInputElement | null>(null);
const panel = ref<HTMLElement | null>(null);
let previousFocus: HTMLElement | null = null;
let focusGeneration = 0;

const ctx = computed<ActionContext>(() => ({
  repoIds: workspace.toplevel ? [workspace.toplevel] : [],
  selection: {},
  source: "palette",
  place: "FindAction",
  folderPath: workspace.folderPath,
}));

const results = computed(() =>
  searchActions(query.value, ctx.value, (action) => resolveActionTitle(action, t))
    .slice(0, 30)
    .map((a) => ({
      id: a.id,
      title: resolveActionTitle(a, t),
      shortcut: shortcutFor(a)[0],
      enabled: isEnabled(a, ctx.value) === true,
    })),
);

function restoreFocus() {
  ++focusGeneration;
  previousFocus?.focus({ preventScroll: true });
  previousFocus = null;
}

watch(
  () => layout.findActionOpen,
  async (open) => {
    if (open) {
      previousFocus = document.activeElement as HTMLElement | null;
      const generation = ++focusGeneration;
      query.value = "";
      // This synchronous watcher can run before Vue queues the render.
      // Wait through that render before using the newly mounted input.
      await nextTick();
      await nextTick();
      if (generation === focusGeneration && layout.findActionOpen) inputEl.value?.focus();
    } else {
      restoreFocus();
    }
  },
  { flush: "sync", immediate: true },
);
watch(
  () => workspace.repoPath,
  () => {
    layout.findActionOpen = false;
  },
);
onUnmounted(restoreFocus);

async function pick(id: string) {
  if (!results.value.some((action) => action.id === id && action.enabled)) return;
  layout.findActionOpen = false;
  try {
    await runAction(id, ctx.value);
  } catch (error) {
    toast({ title: formatErrorMessage(error) });
  }
}

function onKey(e: KeyboardEvent) {
  if (e.isComposing) return;
  const buttons = Array.from(
    panel.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
  );
  const focused = document.activeElement;
  const index = buttons.indexOf(focused as HTMLButtonElement);
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    layout.findActionOpen = false;
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next =
      index < 0
        ? e.key === "ArrowDown"
          ? 0
          : buttons.length - 1
        : (index + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  } else if ((e.key === "Home" || e.key === "End") && index >= 0) {
    e.preventDefault();
    buttons[e.key === "Home" ? 0 : buttons.length - 1]?.focus();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (index >= 0) buttons[index]?.click();
    else if (focused === inputEl.value) buttons[0]?.click();
  } else if (e.key === "Tab") {
    const focusable = [inputEl.value, ...buttons].filter(
      (el): el is HTMLInputElement | HTMLButtonElement => !!el,
    );
    const current = focusable.indexOf(focused as HTMLInputElement);
    e.preventDefault();
    focusable[(current + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length]?.focus();
  }
}
</script>

<template>
  <div
    v-if="layout.findActionOpen"
    class="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 pt-[12vh]"
    @click.self="layout.findActionOpen = false"
    @keydown="onKey"
  >
    <div
      ref="panel"
      role="dialog"
      aria-modal="true"
      :aria-label="t('actions.findAction')"
      class="mx-3 w-full max-w-lg overflow-hidden rounded-lg border bg-popover shadow-lg"
    >
      <input
        ref="inputEl"
        v-model="query"
        class="h-10 w-full border-b bg-transparent px-3 text-sm outline-none"
        :placeholder="t('actions.findAction')"
        :aria-label="t('actions.findAction')"
      />
      <ul class="max-h-80 overflow-auto p-1">
        <li v-for="a in results" :key="a.id">
          <button
            type="button"
            :disabled="!a.enabled"
            class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none disabled:cursor-default disabled:opacity-50"
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
