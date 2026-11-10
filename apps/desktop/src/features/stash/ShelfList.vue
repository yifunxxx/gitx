<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";
import { ChevronRight } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import VirtualList from "@/components/common/VirtualList.vue";
import { markContextHandled } from "@/lib/contextMenu";
import { useStashShelfStore } from "@/stores/stashShelfStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import ShelfFiles from "./ShelfFiles.vue";

type Section = "shelf" | "deleted-shelf";
type Action = "unshelve" | "exportPatch" | "rename" | "delete" | "restore";
const { t } = useI18n();
const store = useStashShelfStore();
const workspace = useWorkspaceStore();
const rows = ref<HTMLElement | null>(null);
const menuPanel = ref<HTMLElement | null>(null);
const removeApplied = ref(false);
const fileListId = useId();
const expanded = ref(new Set<string>());
const lists = new Map<Section, { scrollToIndex: (index: number) => void }>();
function setList(section: Section, value: unknown) {
  if (value) lists.set(section, value as { scrollToIndex: (index: number) => void });
  else lists.delete(section);
}
function entryHeight(section: Section, entry: { id: string; paths: string[] }) {
  return (
    44 +
    (expanded.value.has(expansionKey(section, entry.id)) && entry.paths.length
      ? Math.min(entry.paths.length, 8) * 24 + 8
      : 0)
  );
}
function listHeight(section: Section) {
  let height = 0;
  for (const entry of entries(section)) {
    height += entryHeight(section, entry);
    if (height >= 440) return 440;
  }
  return height;
}
const menu = ref<{
  id: string;
  section: Section;
  x: number;
  y: number;
  repository: number;
  navigation: number;
} | null>(null);
const sections = computed(() => [
  { kind: "shelf" as const, entries: store.shelves, title: "shelf.section", empty: "shelf.empty" },
  ...(store.showDeleted
    ? [
        {
          kind: "deleted-shelf" as const,
          entries: store.deletedShelves,
          title: "shelf.recentlyDeleted",
          empty: "shelf.deletedEmpty",
        },
      ]
    : []),
]);
const selectedShelf = computed(() => store.shelves.find((s) => s.id === store.selectedShelfId));
const selectedDeleted = computed(() =>
  store.showDeleted
    ? store.deletedShelves.find((s) => s.id === store.selectedDeletedShelfId)
    : undefined,
);
const actions = computed<Action[]>(() =>
  menu.value?.section === "deleted-shelf"
    ? ["restore"]
    : ["unshelve", "exportPatch", "rename", "delete"],
);

function entries(section: Section) {
  return section === "shelf" ? store.shelves : store.showDeleted ? store.deletedShelves : [];
}
function expansionKey(section: Section, id: string) {
  return `${section}:${id}`;
}
function filesId(section: Section, id: string) {
  return `${fileListId}-${section}-${id}`;
}
function setExpanded(section: Section, id: string, open: boolean) {
  const key = expansionKey(section, id);
  if (open) expanded.value.add(key);
  else expanded.value.delete(key);
  select(section, id);
  focusRow(section, id);
}
watch(
  () => [workspace.repoPath, workspace.navigationToken()],
  () => expanded.value.clear(),
);
watch(
  () =>
    sections.value.flatMap((section) =>
      section.entries.map((s) => expansionKey(section.kind, s.id)),
    ),
  (keys) => {
    const available = new Set(keys);
    for (const key of expanded.value) if (!available.has(key)) expanded.value.delete(key);
  },
);
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
function createdTime(timestamp: number) {
  const date = new Date(timestamp * 1000);
  if (!Number.isFinite(date.getTime())) return null;
  return { label: dateFormat.format(date), iso: date.toISOString() };
}
function selected(section: Section) {
  return section === "shelf" ? selectedShelf.value?.id : selectedDeleted.value?.id;
}
function select(section: Section, id: string) {
  if (!entries(section).some((s) => s.id === id)) return;
  store.selectedShelfId = section === "shelf" ? id : null;
  store.selectedDeletedShelfId = section === "deleted-shelf" ? id : null;
}
async function focusRow(section: Section, id: string) {
  const repository = store.repositoryToken();
  const navigation = workspace.navigationToken();
  const index = entries(section).findIndex((entry) => entry.id === id);
  if (index < 0) return;
  lists.get(section)?.scrollToIndex(index);
  await nextTick();
  if (repository !== store.repositoryToken() || navigation !== workspace.navigationToken()) return;
  Array.from(rows.value?.querySelectorAll<HTMLButtonElement>(`[data-entry="${section}"]`) ?? [])
    .find((row) => row.dataset.shelfId === id)
    ?.focus({ preventScroll: true });
}
function closeMenu(restoreFocus = true) {
  const target = menu.value;
  menu.value = null;
  if (restoreFocus && target) focusRow(target.section, target.id);
}
watch(
  () => [workspace.repoPath, workspace.navigationToken(), store.showDeleted],
  () => closeMenu(false),
);
watch(
  () => !menu.value || entries(menu.value.section).some((s) => s.id === menu.value!.id),
  (exists) => {
    if (!exists) closeMenu(false);
  },
);
async function openMenu(section: Section, id: string, event: MouseEvent | KeyboardEvent) {
  if (event instanceof MouseEvent) markContextHandled(event);
  else {
    event.preventDefault();
    event.stopPropagation();
  }
  if (store.busy || !entries(section).some((s) => s.id === id)) return;
  select(section, id);
  const row = event.currentTarget as HTMLElement;
  row.focus();
  const rect = row.getBoundingClientRect();
  menu.value = {
    id,
    section,
    x: event instanceof MouseEvent ? event.clientX : rect.left + 12,
    y: event instanceof MouseEvent ? event.clientY : rect.bottom,
    repository: store.repositoryToken(),
    navigation: workspace.navigationToken(),
  };
  await nextTick();
  menuPanel.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}
async function restore(id: string) {
  const repository = store.repositoryToken();
  const navigation = workspace.navigationToken();
  if (!(await store.restoreShelf(id))) return;
  if (repository !== store.repositoryToken() || navigation !== workspace.navigationToken()) return;
  await nextTick();
  if (store.selectedShelfId === id) focusRow("shelf", id);
}
function runMenu(action: Action) {
  const target = menu.value;
  if (
    !target ||
    store.busy ||
    target.repository !== store.repositoryToken() ||
    target.navigation !== workspace.navigationToken() ||
    !entries(target.section).some((s) => s.id === target.id)
  ) {
    closeMenu(false);
    return;
  }
  closeMenu();
  if (target.section === "deleted-shelf") {
    if (action === "restore") void restore(target.id);
    return;
  }
  if (action === "unshelve") void store.unshelve(target.id, removeApplied.value);
  if (action === "exportPatch") void store.promptExportShelf(target.id);
  if (action === "rename") void store.promptRenameShelf(target.id);
  if (action === "delete") void store.deleteShelf(target.id);
}
function rowKey(event: KeyboardEvent, section: Section, index: number) {
  if (event.isComposing) return;
  const list = entries(section);
  const entry = list[index];
  if (!entry) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    event.stopPropagation();
    if (entry.paths.length) setExpanded(section, entry.id, event.key === "ArrowRight");
    return;
  }
  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
    void openMenu(section, entry.id, event);
    return;
  }
  if (event.key === "Delete" || event.key === "F2") {
    event.preventDefault();
    event.stopPropagation();
    if (section === "shelf" && !event.repeat && !store.busy) {
      if (event.key === "Delete") void store.deleteShelf(entry.id);
      else void store.promptRenameShelf(entry.id);
    }
    return;
  }
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? list.length - 1
        : event.key === "ArrowDown"
          ? Math.min(list.length - 1, index + 1)
          : event.key === "ArrowUp"
            ? Math.max(0, index - 1)
            : null;
  if (next == null) return;
  event.preventDefault();
  event.stopPropagation();
  select(section, list[next]!.id);
  focusRow(section, list[next]!.id);
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
  if (!items.length) return;
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
  event.stopPropagation();
  items[next]?.focus();
}
</script>

<template>
  <div ref="rows">
    <section v-for="section in sections" :key="section.kind" :aria-label="t(section.title)">
      <div class="flex flex-wrap items-center justify-between gap-2 px-2 py-1">
        <span class="font-medium text-muted-foreground">{{ t(section.title) }}</span>
        <Button
          v-if="section.kind === 'shelf'"
          size="xs"
          variant="ghost"
          :aria-pressed="store.showDeleted"
          :class="store.showDeleted ? 'bg-accent' : ''"
          :disabled="!workspace.isRepo || store.busy"
          @click="store.setShowDeleted(!store.showDeleted)"
        >
          {{ t("shelf.showDeleted") }}
        </Button>
      </div>
      <VirtualList
        v-if="section.entries.length"
        :ref="(value) => setList(section.kind, value)"
        :items="section.entries"
        :item-height="44"
        :get-item-height="(entry) => entryHeight(section.kind, entry)"
        :get-key="(entry) => entry.id"
        :overscan="3"
        :style="{ height: `${listHeight(section.kind)}px` }"
        class="flex-none"
        preserve-scroll-anchor
      >
        <template #default="{ item: s, index }">
          <div
            class="flex h-11 min-w-0 items-center"
            :class="selected(section.kind) === s.id ? 'bg-accent' : ''"
          >
            <button
              type="button"
              tabindex="-1"
              :disabled="!s.paths.length"
              class="flex size-7 shrink-0 items-center justify-center hover:bg-accent/50 disabled:opacity-30"
              data-shelf-disclosure
              :aria-label="
                t(
                  expanded.has(expansionKey(section.kind, s.id))
                    ? 'shelf.collapseFiles'
                    : 'shelf.expandFiles',
                  { name: s.message },
                )
              "
              :aria-expanded="expanded.has(expansionKey(section.kind, s.id))"
              :aria-controls="filesId(section.kind, s.id)"
              @click="
                setExpanded(section.kind, s.id, !expanded.has(expansionKey(section.kind, s.id)))
              "
            >
              <ChevronRight
                class="size-3.5"
                :class="expanded.has(expansionKey(section.kind, s.id)) ? 'rotate-90' : ''"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              :data-entry="section.kind"
              :data-shelf-id="s.id"
              :title="s.message"
              :aria-pressed="selected(section.kind) === s.id"
              :aria-expanded="expanded.has(expansionKey(section.kind, s.id))"
              :aria-controls="filesId(section.kind, s.id)"
              :tabindex="
                selected(section.kind) === s.id || (!selected(section.kind) && index === 0) ? 0 : -1
              "
              class="flex h-full min-w-0 flex-1 cursor-pointer flex-col justify-center gap-0.5 pr-2 text-left hover:bg-accent/50 focus-visible:outline focus-visible:outline-ring"
              @click="select(section.kind, s.id)"
              @keydown="rowKey($event, section.kind, index)"
              @contextmenu="openMenu(section.kind, s.id, $event)"
            >
              <span class="flex w-full min-w-0 items-center gap-2">
                <span class="truncate">{{ s.message }}</span>
                <span class="shrink-0 text-muted-foreground">({{ s.paths.length }})</span>
              </span>
              <time
                v-if="createdTime(s.createdAt)"
                :datetime="createdTime(s.createdAt)!.iso"
                :title="t('shelf.createdAt')"
                class="shrink-0 text-[10px] text-muted-foreground"
                >{{ createdTime(s.createdAt)!.label }}</time
              >
            </button>
          </div>
          <ShelfFiles
            v-if="expanded.has(expansionKey(section.kind, s.id)) && s.paths.length"
            :id="filesId(section.kind, s.id)"
            :paths="s.paths"
            :label="t('shelf.files', { name: s.message })"
            @collapse="setExpanded(section.kind, s.id, false)"
          />
        </template>
      </VirtualList>
      <div v-if="!section.entries.length" class="px-3 py-2 text-muted-foreground">
        {{ t(section.empty) }}
      </div>
      <fieldset
        v-if="section.kind === 'shelf' && selectedShelf"
        :disabled="store.busy"
        class="flex flex-wrap items-center gap-1 px-2 py-1"
      >
        <Button
          size="xs"
          variant="outline"
          @click="store.unshelve(selectedShelf!.id, removeApplied)"
        >
          {{ t("shelf.unshelve") }}
        </Button>
        <label class="flex items-center gap-1 text-[11px]">
          <input v-model="removeApplied" type="checkbox" />{{ t("shelf.removeApplied") }}
        </label>
        <Button size="xs" variant="outline" @click="store.promptExportShelf(selectedShelf!.id)">{{
          t("shelf.exportPatch")
        }}</Button>
        <Button size="xs" variant="outline" @click="store.promptRenameShelf(selectedShelf!.id)">{{
          t("shelf.rename")
        }}</Button>
        <Button size="xs" variant="outline" @click="store.deleteShelf(selectedShelf!.id)">{{
          t("shelf.delete")
        }}</Button>
      </fieldset>
      <fieldset
        v-if="section.kind === 'deleted-shelf' && selectedDeleted"
        :disabled="store.busy"
        class="flex flex-wrap items-center gap-2 px-2 py-1"
      >
        <Button size="xs" variant="outline" @click="restore(selectedDeleted!.id)">{{
          t("shelf.restore")
        }}</Button>
        <span class="text-muted-foreground">{{ t("shelf.restoreHint") }}</span>
      </fieldset>
    </section>
    <ContextMenuSurface
      :open="!!menu"
      :anchor-x="menu?.x ?? 0"
      :anchor-y="menu?.y ?? 0"
      :width="220"
      :estimated-height="actions.length * 32 + 8"
      @close="closeMenu()"
    >
      <div
        ref="menuPanel"
        role="menu"
        :aria-label="
          t(menu?.section === 'deleted-shelf' ? 'shelf.recentlyDeleted' : 'shelf.section')
        "
        @keydown="menuKey"
      >
        <button
          v-for="action in actions"
          :key="action"
          type="button"
          role="menuitem"
          class="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-50"
          :class="action === 'delete' ? 'text-destructive' : ''"
          :disabled="store.busy"
          @click="runMenu(action)"
        >
          {{ t(`shelf.${action}`) }}
        </button>
      </div>
    </ContextMenuSurface>
  </div>
</template>
