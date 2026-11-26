<script setup lang="ts">
import { fileTheme } from "@/features/editor/editorThemes";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  redo,
  redoDepth,
  selectAll,
  undo,
  undoDepth,
} from "@codemirror/commands";
import { fileChangeHighlights } from "./fileChangeHighlights";
import { editorChrome } from "@/features/editor/editorChrome";
import { runEditorSearch } from "@/features/editor/editorSearch";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ tabId: string }>();
const store = useFileViewerStore();
const { t } = useI18n();

const tab = computed(() => store.tabs.find((t) => t.id === props.tabId));
const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
const highlights = new Compartment();

type MenuAction = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "save";
type MenuState = {
  x: number;
  y: number;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  editable: boolean;
  dirty: boolean;
  saving: boolean;
};
const menu = ref<MenuState | null>(null);

function release() {
  closeMenu();
  view?.destroy();
  view = null;
}

function closeMenu() {
  menu.value = null;
}

function snapshotMenu(event: MouseEvent | KeyboardEvent): MenuState | null {
  if (!view || !tab.value) return null;
  const point =
    "clientX" in event
      ? { x: event.clientX, y: event.clientY }
      : (() => {
          const rect = view.dom.getBoundingClientRect();
          return { x: rect.left + 8, y: rect.top + 8 };
        })();
  return {
    x: point.x,
    y: point.y,
    hasSelection: !view.state.selection.main.empty,
    canUndo: undoDepth(view.state) > 0,
    canRedo: redoDepth(view.state) > 0,
    editable: !!tab.value.editable,
    dirty: !!tab.value.dirty,
    saving: !!tab.value.saving,
  };
}

function openMenu(event: MouseEvent | KeyboardEvent) {
  event.preventDefault();
  event.stopPropagation();
  menu.value = snapshotMenu(event);
}

function menuDisabled(action: MenuAction) {
  const state = menu.value;
  if (!state || !view) return true;
  switch (action) {
    case "undo":
      return !state.editable || !state.canUndo;
    case "redo":
      return !state.editable || !state.canRedo;
    case "cut":
      return !state.editable || !state.hasSelection;
    case "copy":
      return !state.hasSelection;
    case "paste":
      return !state.editable;
    case "selectAll":
      return false;
    case "save":
      return !state.editable || !state.dirty || state.saving;
  }
}

async function runMenu(action: MenuAction) {
  const live = view;
  const current = tab.value;
  closeMenu();
  if (!live || !current) return;
  live.focus();
  switch (action) {
    case "undo":
      undo(live);
      break;
    case "redo":
      redo(live);
      break;
    case "selectAll":
      selectAll(live);
      break;
    case "copy":
      await copySelection(live);
      break;
    case "cut":
      await cutSelection(live);
      break;
    case "paste":
      await pasteClipboard(live);
      break;
    case "save":
      await store.save(current.id);
      break;
  }
}

async function copySelection(target: EditorView) {
  const { from, to } = target.state.selection.main;
  if (from === to) return;
  const text = target.state.sliceDoc(from, to);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard may be denied in some test / locked-down hosts.
  }
}

async function cutSelection(target: EditorView) {
  const current = tab.value;
  const state = target.state;
  const { from, to } = state.selection.main;
  if (from === to || !current?.editable || !state.facet(EditorView.editable)) return;
  const text = state.sliceDoc(from, to);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  if (!canApplyClipboard(target, current, state)) return;
  target.dispatch({ changes: { from, to, insert: "" }, userEvent: "delete.cut" });
}

async function pasteClipboard(target: EditorView) {
  const current = tab.value;
  const state = target.state;
  if (!current?.editable || !state.facet(EditorView.editable)) return;
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  if (!canApplyClipboard(target, current, state)) return;
  const { from, to } = state.selection.main;
  target.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length },
    userEvent: "input.paste",
  });
}

function canApplyClipboard(
  target: EditorView,
  current: NonNullable<typeof tab.value>,
  state: EditorState,
) {
  return (
    view === target &&
    tab.value === current &&
    store.tabs.includes(current) &&
    current.editable &&
    !current.loading &&
    target.state.doc === state.doc &&
    target.state.selection.eq(state.selection)
  );
}

function mount() {
  release();
  if (!host.value || !tab.value || tab.value.loading) return;
  const current = tab.value;
  const text = current.text;
  const hunks = current.hunks;
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([
          {
            key: "Mod-s",
            run: () => {
              if (tab.value === current) void store.save(current.id);
              return true;
            },
            preventDefault: true,
          },
          { key: "Mod-Shift-z", run: redo, preventDefault: true },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.editable.of(!!current.editable),
        EditorState.readOnly.of(!current.editable),
        ...editorChrome({ caret: !!current.editable, translate: t }),
        fileTheme,
        highlights.of(fileChangeHighlights(hunks)),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          if (tab.value !== current || !store.tabs.includes(current)) return;
          store.setDocument(current.id, update.state.doc.toString());
        }),
        EditorView.domEventHandlers({
          contextmenu: (event, editorView) => {
            event.preventDefault();
            menu.value = {
              x: event.clientX,
              y: event.clientY,
              hasSelection: !editorView.state.selection.main.empty,
              canUndo: undoDepth(editorView.state) > 0,
              canRedo: redoDepth(editorView.state) > 0,
              editable: !!store.tabs.find((t) => t.id === props.tabId)?.editable,
              dirty: !!store.tabs.find((t) => t.id === props.tabId)?.dirty,
              saving: !!store.tabs.find((t) => t.id === props.tabId)?.saving,
            };
            return true;
          },
        }),
      ],
    }),
  });
}

function revealPosition() {
  const target = tab.value?.reveal;
  if (!view || !target || tab.value?.loading) return;
  const line = view.state.doc.line(
    Math.max(1, Math.min(view.state.doc.lines, Math.floor(target.line))),
  );
  const position = line.from + Math.max(0, Math.min(line.length, Math.floor(target.column) - 1));
  view.dispatch({
    selection: { anchor: position },
    effects: EditorView.scrollIntoView(position, { y: "center" }),
  });
  view.focus();
}
watch(() => tab.value?.reveal, revealPosition, { flush: "post" });

onBeforeUnmount(() => {
  closeMenu();
  release();
});
watch(
  [
    host,
    () => tab.value?.id,
    () => tab.value?.loading,
    () => tab.value?.editable,
    () => tab.value?.loadGeneration,
  ],
  () => {
    mount();
    revealPosition();
  },
  // Loading replaces the host with v-if; wait until Vue has mounted its replacement.
  { flush: "post" },
);
watch(
  () => tab.value?.hunks,
  (hunks) => {
    if (!view || !tab.value || !hunks || tab.value.dirty) return;
    // Updating saved line marks must preserve the draft, selection and undo history.
    view.dispatch({ effects: highlights.reconfigure(fileChangeHighlights(hunks)) });
  },
  { flush: "post" },
);

const menuActions = computed(() => {
  const selected = menu.value?.hasSelection;
  const actions: MenuAction[] = selected
    ? ["cut", "copy", "paste", "undo", "redo", "selectAll", "save"]
    : ["undo", "redo", "paste", "selectAll", "save"];
  return actions;
});
</script>

<template>
  <div
    v-if="tab"
    class="flex h-full min-h-0 flex-col"
    @keydown="
      ($event.key === 'ContextMenu' || ($event.shiftKey && $event.key === 'F10')) &&
      openMenu($event)
    "
  >
    <div class="flex h-8 items-center gap-2 border-b bg-dbx-chrome px-2 text-xs">
      <span class="font-medium">{{ tab.path }}</span>
      <span v-if="!tab.folderPath" class="text-muted-foreground">vs HEAD</span>
      <span v-if="tab.dirty" class="text-muted-foreground">· {{ t("editor.unsaved") }}</span>
      <span v-if="tab.saving" class="text-muted-foreground">· {{ t("editor.saving") }}</span>
      <span v-if="tab.deletedOnDisk" class="text-warning">{{ t("fileOps.deletedDraft") }}</span>
      <div class="ml-auto flex gap-2">
        <button
          class="rounded px-2 py-1 hover:bg-accent"
          @click="runEditorSearch('Editor.Find', view)"
        >
          {{ t("editor.find") }}
        </button>
        <button
          v-if="tab.editable"
          class="rounded px-2 py-1 hover:bg-accent"
          @click="runEditorSearch('Editor.Replace', view)"
        >
          {{ t("editor.replace") }}
        </button>
      </div>
    </div>
    <div v-if="tab.loading" class="p-4 text-xs text-muted-foreground">Loading…</div>
    <div
      v-else
      ref="host"
      class="min-h-0 flex-1 overflow-hidden"
      data-file-viewer-host
      @contextmenu="openMenu"
    />
    <ContextMenuSurface
      :label="t('editor.menu')"
      :open="!!menu"
      :anchor-x="menu?.x ?? 0"
      :anchor-y="menu?.y ?? 0"
      :width="200"
      :estimated-height="menuActions.length * 32"
      @close="closeMenu"
    >
      <div>
        <button
          v-for="action in menuActions"
          :key="action"
          type="button"
          role="menuitem"
          class="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-40"
          :disabled="menuDisabled(action)"
          @click="runMenu(action)"
        >
          {{ t(`editor.${action}`) }}
        </button>
      </div>
    </ContextMenuSurface>
  </div>
</template>

<style>
.cm-file-modified {
  border-left: 2px solid #ca8a04;
}
.cm-diff-insert {
  border-left: 2px solid #16a34a;
}
</style>
