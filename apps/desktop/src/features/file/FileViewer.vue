<script setup lang="ts">
import { fileTheme } from "@/features/editor/editorThemes";
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import {
  defaultKeymap,
  historyKeymap,
  redo,
  redoDepth,
  selectAll,
  undo,
  undoDepth,
} from "@codemirror/commands";
import { fileChangeHighlights } from "./fileChangeHighlights";
import { editorChrome } from "@/features/editor/editorChrome";
import { useFileViewerStore, type FileViewerTab } from "@/stores/fileViewerStore";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import { sourceText } from "@/components/common/preservedText";
import { createFileEditorState, fileViewConfig } from "./fileEditorState";
import { useI18n } from "vue-i18n";
import { formatErrorMessage } from "@/lib/errors";

const props = defineProps<{ tabId: string }>();
const store = useFileViewerStore();
const { t } = useI18n();

const tab = computed(() => store.tabs.find((t) => t.id === props.tabId));
const host = ref<HTMLDivElement | null>(null);
let view: EditorView | null = null;
let viewTab: FileViewerTab | null = null;
let viewGeneration = 0;
let viewEditable = false;
let viewText = "";
const highlights = new Compartment();
const editability = new Compartment();

type MenuAction = "undo" | "redo" | "cut" | "copy" | "paste" | "selectAll" | "save";
type ClipboardAction = "copy" | "cut" | "paste";
type ClipboardRequest = {
  action: ClipboardAction;
  view: EditorView;
  tab: FileViewerTab;
  state: EditorState;
};
const clipboardPending = shallowRef<ClipboardRequest | null>(null);
const clipboardFailure = shallowRef<{ request: ClipboardRequest; message: string } | null>(null);
const canRetryClipboard = computed(() => {
  const request = clipboardFailure.value?.request;
  return !!request && clipboardContextCurrent(request);
});
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
  clipboardPending.value = null;
  clipboardFailure.value = null;
  if (view && viewTab) {
    store.cacheEditorSnapshot(viewTab, {
      state: view.state.update({ effects: fileViewConfig.reconfigure([]) }).state,
      scroll: view.scrollSnapshot(),
      text: viewText,
      generation: viewGeneration,
      editable: viewEditable,
    });
  }
  view?.destroy();
  view = null;
  viewTab = null;
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
    editable: !!tab.value.editable && !tab.value.restorePending,
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
  if (clipboardPending.value && ["copy", "cut", "paste"].includes(action)) return true;
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
  if (current.restorePending && action !== "copy" && action !== "selectAll") return;
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
    case "cut":
    case "paste":
      await runClipboard(action);
      break;
    case "save":
      await store.save(current.id);
      break;
  }
}

async function runClipboard(action: ClipboardAction) {
  const target = view;
  const current = tab.value;
  if (!target || !current || clipboardPending.value) return;
  const state = target.state;
  const { from, to } = state.selection.main;
  const request = { action, view: target, tab: current, state };
  if (!clipboardContextCurrent(request) || (action !== "paste" && from === to)) return;
  clipboardFailure.value = null;
  clipboardPending.value = request;
  try {
    let text = "";
    if (action === "paste") text = await navigator.clipboard.readText();
    else await navigator.clipboard.writeText(state.sliceDoc(from, to));
    if (clipboardPending.value !== request || !clipboardContextCurrent(request)) return;
    if (action === "copy") return;
    const insert = state.toText(text);
    target.dispatch({
      changes: { from, to, insert },
      selection: { anchor: from + insert.length },
      userEvent: action === "paste" ? "input.paste" : "delete.cut",
    });
  } catch (reason) {
    if (clipboardPending.value === request && clipboardContextCurrent(request))
      clipboardFailure.value = { request, message: formatErrorMessage(reason) };
  } finally {
    if (clipboardPending.value === request) clipboardPending.value = null;
  }
}

function retryClipboard() {
  const request = clipboardFailure.value?.request;
  if (request && clipboardContextCurrent(request)) void runMenu(request.action);
}

function dismissClipboardFailure() {
  clipboardFailure.value = null;
  view?.focus();
}

function clipboardContextCurrent({ view: target, tab: current, state, action }: ClipboardRequest) {
  return (
    view === target &&
    tab.value === current &&
    store.tabs.includes(current) &&
    (action === "copy" ||
      (current.editable && !current.restorePending && target.state.facet(EditorView.editable))) &&
    !current.loading &&
    target.state.doc === state.doc &&
    target.state.selection.eq(state.selection)
  );
}

function mount() {
  release();
  if (!host.value || !tab.value || tab.value.loading) return;
  const current = tab.value;
  const snapshot = store.takeEditorSnapshot(current);
  const state = snapshot?.state ?? createFileEditorState(current.text);
  viewTab = current;
  viewGeneration = current.loadGeneration;
  viewEditable = current.editable;
  viewText = current.text;
  const hunks = current.hunks;
  view = new EditorView({
    parent: host.value,
    scrollTo: snapshot?.scroll,
    state: state.update({
      effects: fileViewConfig.reconfigure([
        lineNumbers(),
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
        editability.of([
          EditorView.editable.of(!!current.editable && !current.restorePending),
          EditorState.readOnly.of(!current.editable || !!current.restorePending),
        ]),
        ...editorChrome({ caret: !!current.editable, translate: t }),
        fileTheme,
        highlights.of(fileChangeHighlights(hunks)),
        EditorView.updateListener.of((update) => {
          if (update.docChanged || update.selectionSet) clipboardFailure.value = null;
          if (!update.docChanged) return;
          if (tab.value !== current || !store.tabs.includes(current)) return;
          viewText = sourceText(update.state);
          store.setDocument(current.id, viewText);
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
              editable: !!current.editable && !current.restorePending,
              dirty: !!store.tabs.find((t) => t.id === props.tabId)?.dirty,
              saving: !!store.tabs.find((t) => t.id === props.tabId)?.saving,
            };
            return true;
          },
        }),
      ]),
    }).state,
  });
}

function revealPosition() {
  const target = tab.value?.reveal;
  if (!view || viewTab !== tab.value || !target || tab.value?.loading) return;
  // A search jump is a request, not the tab's permanent cursor position.
  tab.value.reveal = undefined;
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

watch(
  () => tab.value?.restorePending,
  () => {
    if (!view || !tab.value || viewTab !== tab.value) return;
    closeMenu();
    const editable = !!tab.value.editable && !tab.value.restorePending;
    // Temporary disk-write protection must not remount the editor: failed
    // restores retain selection, scroll position and the complete undo history.
    view.dispatch({
      effects: editability.reconfigure([
        EditorView.editable.of(editable),
        EditorState.readOnly.of(!editable),
      ]),
    });
  },
  { flush: "sync" },
);

// A loading tab replaces the host during render. Capture geometry before Vue
// detaches the old editor; the post-render watcher mounts its replacement.
watch(
  [
    () => tab.value,
    () => tab.value?.loading,
    () => tab.value?.editable,
    () => tab.value?.loadGeneration,
  ],
  release,
  { flush: "pre" },
);

onBeforeUnmount(() => {
  closeMenu();
  release();
});
watch(
  [
    host,
    () => tab.value,
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
    if (!view || viewTab !== tab.value || !tab.value || !hunks || tab.value.dirty) return;
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
    :aria-busy="tab.restorePending || !!clipboardPending || undefined"
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
      <span v-if="tab.restorePending" role="status" class="text-muted-foreground"
        >· {{ t("history.restoring") }}</span
      >
      <span v-if="tab.deletedOnDisk" class="text-warning">{{ t("fileOps.deletedDraft") }}</span>
    </div>
    <div
      v-if="clipboardPending"
      role="status"
      class="shrink-0 border-b px-2 py-1 text-xs text-muted-foreground"
    >
      {{ t(`editor.clipboardPending.${clipboardPending.action}`) }}
    </div>
    <div
      v-if="clipboardFailure"
      role="alert"
      class="flex shrink-0 items-start gap-2 border-b px-2 py-1 text-xs"
    >
      <span class="max-h-24 min-w-0 flex-1 overflow-auto break-words text-destructive">
        {{ t(`editor.clipboardFailed.${clipboardFailure.request.action}`) }}
        {{ clipboardFailure.message }}
      </span>
      <button
        type="button"
        data-clipboard-retry
        class="shrink-0 rounded px-1 hover:bg-accent focus-visible:outline-2 disabled:opacity-40"
        :disabled="!canRetryClipboard"
        @click="retryClipboard"
      >
        {{ t("editor.retryClipboard") }}
      </button>
      <button
        type="button"
        class="shrink-0 rounded px-1 hover:bg-accent focus-visible:outline-2"
        @click="dismissClipboardFailure"
      >
        {{ t("editor.dismissClipboard") }}
      </button>
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
