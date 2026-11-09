<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import { markContextHandled } from "@/lib/contextMenu";
import { useStashShelfStore } from "@/stores/stashShelfStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

type Section = "shelf" | "deleted-shelf";
type Action = "unshelve" | "rename" | "delete" | "restore";
const { t } = useI18n();
const store = useStashShelfStore();
const workspace = useWorkspaceStore();
const rows = ref<HTMLElement | null>(null);
const menuPanel = ref<HTMLElement | null>(null);
const removeApplied = ref(false);
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
  menu.value?.section === "deleted-shelf" ? ["restore"] : ["unshelve", "rename", "delete"],
);

function entries(section: Section) {
  return section === "shelf" ? store.shelves : store.showDeleted ? store.deletedShelves : [];
}
function selected(section: Section) {
  return section === "shelf" ? selectedShelf.value?.id : selectedDeleted.value?.id;
}
function select(section: Section, id: string) {
  if (!entries(section).some((s) => s.id === id)) return;
  store.selectedShelfId = section === "shelf" ? id : null;
  store.selectedDeletedShelfId = section === "deleted-shelf" ? id : null;
}
function focusRow(section: Section, id: string) {
  Array.from(rows.value?.querySelectorAll<HTMLButtonElement>(`[data-entry="${section}"]`) ?? [])
    .find((row) => row.dataset.shelfId === id)
    ?.focus();
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
  if (action === "rename") void store.promptRenameShelf(target.id);
  if (action === "delete") void store.deleteShelf(target.id);
}
function rowKey(event: KeyboardEvent, section: Section, index: number) {
  if (event.isComposing) return;
  const list = entries(section);
  const entry = list[index];
  if (!entry) return;
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
          :disabled="!workspace.isRepo || store.busy"
          @click="store.setShowDeleted(!store.showDeleted)"
        >
          {{ t("shelf.showDeleted") }}
        </Button>
      </div>
      <button
        v-for="(s, index) in section.entries"
        :key="s.id"
        type="button"
        :data-entry="section.kind"
        :data-shelf-id="s.id"
        :title="s.message"
        :aria-pressed="selected(section.kind) === s.id"
        :tabindex="
          selected(section.kind) === s.id || (!selected(section.kind) && index === 0) ? 0 : -1
        "
        class="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left hover:bg-accent/50 focus-visible:outline focus-visible:outline-ring"
        :class="selected(section.kind) === s.id ? 'bg-accent' : ''"
        @click="select(section.kind, s.id)"
        @keydown="rowKey($event, section.kind, index)"
        @contextmenu="openMenu(section.kind, s.id, $event)"
      >
        <span class="truncate">{{ s.message }}</span>
        <span class="shrink-0 text-muted-foreground">({{ s.paths.length }})</span>
      </button>
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
