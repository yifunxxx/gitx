<script setup lang="ts">
import { getGroup, getAction, isEnabled, isVisible, runAction, shortcutFor } from "@/actions";
import type { ActionContext } from "@/actions";
import { resolveActionTitle } from "@/actions/titles";
import { useLayoutStore } from "@/stores/layoutStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  DropdownMenuRoot as MenuRoot,
  DropdownMenuPortal as MenuPortal,
  DropdownMenuContent as MenuContent,
  DropdownMenuItem as MenuItem,
  DropdownMenuSub as MenuSub,
  DropdownMenuSubTrigger as MenuSubTrigger,
  DropdownMenuSubContent as MenuSubContent,
} from "reka-ui";
import RecentProjectsMenuItems from "./RecentProjectsMenuItems.vue";

const { t } = useI18n();
const layout = useLayoutStore();
const workspace = useWorkspaceStore();
const showRecent = ref(false);
const recentTrigger = ref<HTMLButtonElement | null>(null);
let opener: HTMLElement | null = null;
const anchor = { getBoundingClientRect: () => new DOMRect(40, 48, 0, 0) };
watch(
  () => layout.vcsPopupOpen,
  (open) => {
    showRecent.value = false;
    if (open)
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  },
  { immediate: true, flush: "sync" },
);

function restoreOpener() {
  const active = document.activeElement;
  if (
    opener?.isConnected &&
    (active === document.body || (active instanceof Element && active.closest("[data-vcs-menu]")))
  )
    opener.focus({ preventScroll: true });
}
function close() {
  restoreOpener();
  layout.vcsPopupOpen = false;
}
async function focusRecent(event: Event) {
  event.preventDefault();
  await nextTick();
  const trigger = (event.target as HTMLElement).querySelector<HTMLButtonElement>(
    '[aria-haspopup="menu"]',
  );
  recentTrigger.value = trigger;
  if (layout.vcsPopupOpen) trigger?.focus({ preventScroll: true });
}
function guardKeys(event: KeyboardEvent, submenu = false) {
  if ((event.target as Element).closest('[role="menu"]') !== event.currentTarget) return;
  const modified =
    event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && event.key !== "Tab");
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    modified ||
    event.repeat ||
    event.defaultPrevented
  ) {
    event.stopPropagation();
    if (!event.isComposing && event.keyCode !== 229) event.preventDefault();
    return;
  }
  if (event.key === "Tab" || event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (submenu && event.key === "Escape") {
      showRecent.value = false;
      recentTrigger.value?.focus({ preventScroll: true });
    } else close();
  }
}

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
  close();
  await runAction(id, ctx.value);
}
</script>

<template>
  <MenuRoot v-model:open="layout.vcsPopupOpen">
    <MenuPortal>
      <MenuContent
        :reference="anchor"
        :aria-label="t('actions.vcsOperations')"
        data-vcs-menu
        class="vcs-menu dbx-floating-surface z-[9999] w-70 overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 shadow-lg outline-none"
        style="max-height: var(--reka-popper-available-height); max-width: calc(100vw - 20px)"
        side="bottom"
        align="start"
        :collision-padding="10"
        loop
        @open-auto-focus="focusRecent"
        @close-auto-focus.prevent="restoreOpener"
        @keydown.capture="guardKeys($event)"
        @keydown.stop
        @keyup.stop
      >
        <MenuSub v-model:open="showRecent">
          <MenuSubTrigger as-child>
            <button
              type="button"
              class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-[13px]"
            >
              <span>{{ t("toolbar.recentProjects") }}</span
              ><span aria-hidden="true">›</span>
            </button>
          </MenuSubTrigger>
          <MenuPortal>
            <MenuSubContent
              :aria-label="t('toolbar.recentProjects')"
              data-vcs-menu
              class="vcs-menu dbx-floating-surface z-[10000] w-80 overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 shadow-lg outline-none"
              style="max-height: var(--reka-popper-available-height); max-width: calc(100vw - 20px)"
              :side-offset="4"
              :align-offset="-4"
              :collision-padding="10"
              loop
              @keydown.capture="guardKeys($event, true)"
              @keydown.stop
              @keyup.stop
            >
              <RecentProjectsMenuItems submenu @close="close" />
            </MenuSubContent>
          </MenuPortal>
        </MenuSub>
        <div role="separator" class="my-1 border-t" />
        <div class="px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {{ t("actions.vcsOperations") }}
        </div>
        <MenuItem
          v-for="a in items"
          :key="a.id"
          as="button"
          :disabled="!a.enabled"
          class="flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left text-[13px] leading-4 hover:bg-accent focus-visible:bg-accent disabled:text-muted-foreground disabled:opacity-50"
          @select="pick(a.id)"
        >
          <span>{{ a.title }}</span>
          <kbd
            v-if="a.shortcut"
            class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {{ a.shortcut }}
          </kbd>
        </MenuItem>
      </MenuContent>
    </MenuPortal>
  </MenuRoot>
</template>

<style>
/* Teleported Reka content has a positioning wrapper; scope by menu class. */
.vcs-menu [role="menuitem"] {
  outline: none;
}
.vcs-menu [role="menuitem"][data-highlighted],
.vcs-menu [role="menuitem"]:focus-visible,
.vcs-menu [aria-haspopup="menu"][data-state="open"] {
  background: var(--color-accent);
}
.vcs-menu [role="menuitem"]:focus-visible {
  box-shadow: inset 0 0 0 1px var(--color-ring);
}
.vcs-menu [role="menuitem"][data-disabled] {
  opacity: 0.5;
  cursor: default;
}
</style>
