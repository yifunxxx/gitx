<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { EditorState } from "@codemirror/state";
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
import { useFileViewerStore } from "@/stores/fileViewerStore";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import { useI18n } from "vue-i18n";

const props = defineProps<{ tabId: string }>();
const store = useFileViewerStore();
const { t } = useI18n();

const tab = computed(() => store.tabs.find((t) => t.id === props.tabId));
const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;

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
  const { from, to } = target.state.selection.main;
  if (from === to || !target.state.facet(EditorView.editable)) return;
  const text = target.state.sliceDoc(from, to);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  target.dispatch(target.state.update({ changes: { from, to, insert: "" } }));
}

async function pasteClipboard(target: EditorView) {
  if (!target.state.facet(EditorView.editable)) return;
  let text = "";
  try {
    text = await navigator.clipboard.readText();
  } catch {
    return;
  }
  const { from, to } = target.state.selection.main;
  target.dispatch(
    target.state.update({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    }),
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
              void store.save(props.tabId);
              return true;
            },
            preventDefault: true,
          },
          { key: "Mod-Shift-z", run: redo, preventDefault: true },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.editable.of(!!current.editable),
        ...editorChrome({ caret: !!current.editable }),
        EditorView.theme({
          "&": {
            height: "100%",
            fontSize: "12.5px",
            backgroundColor: "var(--color-background)",
            color: "var(--color-foreground)",
          },
          ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-mono, monospace)" },
          ".cm-gutters": {
            backgroundColor: "var(--color-background)",
            color: "var(--color-muted-foreground)",
            borderRight: "1px solid var(--color-border)",
          },
          ".cm-diff-insert": {
            backgroundColor: "color-mix(in oklab, var(--color-success, #16a34a) 22%, transparent)",
          },
          ".cm-file-modified": {
            backgroundColor: "color-mix(in oklab, var(--color-warning, #ca8a04) 22%, transparent)",
          },
        }),
        fileChangeHighlights(hunks),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          const live = store.tabs.find((t) => t.id === props.tabId);
          if (!live) return;
          store.setDocument(live.id, update.state.doc.toString());
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

onBeforeUnmount(() => {
  closeMenu();
  release();
});
watch(
  [
    host,
    () => tab.value?.id,
    () => tab.value?.hunks,
    () => tab.value?.loading,
    () => tab.value?.editable,
    () => tab.value?.loadGeneration,
  ],
  mount,
  // Loading replaces the host with v-if; wait until Vue has mounted its replacement.
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
      ($event.key === 'ContextMenu' || ($event.shiftKey && $event.key === 'F10')) && openMenu($event)
    "
  >
    <div class="flex h-8 items-center gap-2 border-b bg-dbx-chrome px-2 text-xs">
      <span class="font-medium">{{ tab.path }}</span>
      <span class="text-muted-foreground">vs HEAD</span>
      <span v-if="tab.dirty" class="text-muted-foreground">· {{ t("editor.unsaved") }}</span>
      <span v-if="tab.saving" class="text-muted-foreground">· {{ t("editor.saving") }}</span>
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
