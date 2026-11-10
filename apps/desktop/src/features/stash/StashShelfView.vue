<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { useStashShelfStore } from "@/stores/stashShelfStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useI18n } from "vue-i18n";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import { markContextHandled } from "@/lib/contextMenu";
import VirtualList from "@/components/common/VirtualList.vue";
import ShelfList from "./ShelfList.vue";

const props = defineProps<{
  mode: "combined" | "stash" | "shelf";
}>();

const { t } = useI18n();
const store = useStashShelfStore();
const workspace = useWorkspaceStore();
const reinstateIndex = ref(false);
const stashRows = ref<HTMLElement | null>(null);
const stashList = ref<{ scrollToIndex: (index: number) => void } | null>(null);
async function focusStash(index: number) {
  const sha = store.stashes[index]?.sha;
  if (!sha) return;
  stashList.value?.scrollToIndex(index);
  await nextTick();
  const row = Array.from(
    stashRows.value?.querySelectorAll<HTMLButtonElement>("[data-stash-sha]") ?? [],
  ).find((element) => element.dataset.stashSha === sha);
  row?.focus({ preventScroll: true });
}
const menu = ref<{
  sha: string;
  x: number;
  y: number;
  repository: number;
  navigation: number;
} | null>(null);
const menuPanel = ref<HTMLElement | null>(null);

function closeMenu(restoreFocus = true) {
  const sha = menu.value?.sha;
  menu.value = null;
  if (restoreFocus && sha) {
    const index = store.stashes.findIndex((entry) => entry.sha === sha);
    void focusStash(index);
  }
}

watch(
  () => [workspace.repoPath, workspace.navigationToken(), props.mode],
  () => closeMenu(false),
);
watch(
  () => store.stashes,
  () => {
    if (menu.value && !store.stashes.some((entry) => entry.sha === menu.value!.sha))
      closeMenu(false);
  },
);

async function openMenu(sha: string, event: MouseEvent | KeyboardEvent) {
  if (event instanceof MouseEvent) markContextHandled(event);
  else {
    event.preventDefault();
    event.stopPropagation();
  }
  if (store.busy) return;
  const row = event.currentTarget as HTMLElement;
  store.selectedStashSha = sha;
  row.focus();
  const rect = row.getBoundingClientRect();
  menu.value = {
    sha,
    x: event instanceof MouseEvent ? event.clientX : rect.left + 12,
    y: event instanceof MouseEvent ? event.clientY : rect.bottom,
    repository: store.repositoryToken(),
    navigation: workspace.navigationToken(),
  };
  await nextTick();
  menuPanel.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}

function runMenu(action: "apply" | "pop" | "drop") {
  const target = menu.value;
  closeMenu();
  if (
    !target ||
    target.repository !== store.repositoryToken() ||
    target.navigation !== workspace.navigationToken()
  )
    return;
  const sha = target.sha;
  if (!store.stashes.some((entry) => entry.sha === sha)) return;
  if (action === "apply") void store.applyStash(sha, reinstateIndex.value);
  if (action === "pop") void store.popStash(sha, reinstateIndex.value);
  if (action === "drop") void store.dropStash(sha);
}

function menuKey(event: KeyboardEvent) {
  if (event.key === "Escape" || event.key === "Tab") {
    event.preventDefault();
    event.stopPropagation();
    closeMenu();
    return;
  }
  const items = Array.from(
    menuPanel.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
  );
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (index + 1) % items.length
          : event.key === "ArrowUp"
            ? (index + items.length - 1) % items.length
            : null;
  if (next == null) return;
  event.preventDefault();
  items[next]?.focus();
}

function stashKey(event: KeyboardEvent, index: number) {
  if (event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
  const entry = store.stashes[index];
  if (!entry) return;
  if ((!event.shiftKey && event.key === "ContextMenu") || (event.shiftKey && event.key === "F10")) {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) void openMenu(entry.sha, event);
    return;
  }
  if (event.shiftKey) return;
  if (event.key === "Delete") {
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat && !store.busy) void store.dropStash(entry.sha);
    return;
  }
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? store.stashes.length - 1
        : event.key === "ArrowDown"
          ? Math.min(store.stashes.length - 1, index + 1)
          : event.key === "ArrowUp"
            ? Math.max(0, index - 1)
            : null;
  if (next == null) return;
  event.preventDefault();
  event.stopPropagation();
  store.selectedStashSha = store.stashes[next]!.sha;
  void focusStash(next);
}

const showStashes = computed(() => props.mode === "combined" || props.mode === "stash");
const showShelves = computed(() => props.mode === "combined" || props.mode === "shelf");

onMounted(() => {
  if (workspace.isRepo) void store.refresh();
});

watch(
  () => workspace.repoPath,
  () => {
    if (workspace.isRepo) void store.refresh();
  },
);

async function newStash() {
  await store.promptStash();
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col text-xs">
    <div class="flex h-8 items-center gap-1 border-b px-2">
      <span class="font-medium">
        {{
          props.mode === "combined"
            ? t("toolWindows.stashesShelves")
            : props.mode === "stash"
              ? t("toolWindows.stash")
              : t("toolWindows.shelf")
        }}
      </span>
      <div class="flex-1" />
      <Button
        v-if="showStashes"
        size="xs"
        variant="ghost"
        :disabled="!workspace.isRepo || store.busy"
        @click="newStash"
      >
        {{ t("stash.create") }}
      </Button>
      <Button
        v-if="showShelves"
        size="xs"
        variant="ghost"
        :disabled="!workspace.isRepo || store.busy"
        @click="store.promptImportShelf()"
      >
        {{ t("shelf.importPatch") }}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        :disabled="store.busy || store.loading"
        @click="store.refresh()"
        >{{ t("actions.refreshStatus") }}</Button
      >
    </div>

    <div v-if="store.error" role="alert" class="px-2 py-1 text-destructive">{{ store.error }}</div>
    <div
      v-else-if="store.loading && !store.stashes.length && !store.shelves.length"
      class="p-2 text-muted-foreground"
    >
      {{ t("common.loading") }}
    </div>

    <div ref="stashRows" class="min-h-0 flex-1 overflow-auto">
      <template v-if="showStashes">
        <div class="px-2 py-1 font-medium text-muted-foreground">{{ t("stash.section") }}</div>
        <VirtualList
          v-if="store.stashes.length"
          ref="stashList"
          :items="store.stashes"
          :item-height="28"
          :get-key="(s) => s.sha"
          :style="{
            height: `${Math.min(store.stashes.length, props.mode === 'combined' ? 8 : 18) * 28}px`,
          }"
          class="flex-none"
          preserve-scroll-anchor
        >
          <template #default="{ item: s, index }">
            <button
              :data-stash-sha="s.sha"
              type="button"
              data-entry="stash"
              :tabindex="
                store.selectedStashSha === s.sha || (!store.selectedStash && index === 0) ? 0 : -1
              "
              :title="s.message"
              :aria-pressed="store.selectedStashSha === s.sha"
              class="flex h-full w-full cursor-pointer items-center gap-2 px-2 text-left hover:bg-accent/50 focus-visible:outline focus-visible:outline-ring"
              :class="store.selectedStashSha === s.sha ? 'bg-accent' : ''"
              @click="store.selectedStashSha = s.sha"
              @contextmenu="openMenu(s.sha, $event)"
              @keydown="stashKey($event, index)"
            >
              <span class="font-mono text-muted-foreground">{{ store.stashRefOf(s) }}</span>
              <span class="truncate">{{ s.message }}</span>
            </button>
          </template>
        </VirtualList>
        <div v-if="!store.stashes.length" class="px-3 py-2 text-muted-foreground">
          {{ t("stash.empty") }}
        </div>
        <fieldset
          v-if="store.selectedStash"
          :disabled="store.busy"
          class="flex flex-wrap items-center gap-1 border-b px-2 py-1"
        >
          <label class="mr-2 flex items-center gap-1"
            ><input v-model="reinstateIndex" type="checkbox" />{{
              t("stash.reinstateIndex")
            }}</label
          >
          <Button
            size="xs"
            variant="outline"
            @click="store.applyStash(store.selectedStash!.sha, reinstateIndex)"
          >
            {{ t("stash.apply") }}
          </Button>
          <Button
            size="xs"
            variant="outline"
            @click="store.popStash(store.selectedStash!.sha, reinstateIndex)"
          >
            {{ t("stash.pop") }}
          </Button>
          <Button size="xs" variant="outline" @click="store.dropStash(store.selectedStash!.sha)">
            {{ t("stash.drop") }}
          </Button>
          <Button size="xs" variant="ghost" @click="store.clearStashes()">
            {{ t("stash.clear") }}
          </Button>
        </fieldset>
      </template>

      <ShelfList v-if="showShelves" />
    </div>
    <ContextMenuSurface
      :open="!!menu"
      :anchor-x="menu?.x ?? 0"
      :anchor-y="menu?.y ?? 0"
      :width="220"
      :estimated-height="120"
      @close="closeMenu()"
    >
      <div ref="menuPanel" role="menu" :aria-label="t('stash.section')" @keydown="menuKey">
        <button
          v-for="action in ['apply', 'pop', 'drop'] as const"
          :key="action"
          type="button"
          role="menuitem"
          class="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-50"
          :class="action === 'drop' ? 'text-destructive' : ''"
          :disabled="store.busy"
          @click="runMenu(action)"
        >
          {{ t(`stash.${action}`) }}
        </button>
      </div>
    </ContextMenuSurface>
  </div>
</template>
