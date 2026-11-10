<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowReactive, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Plus, Trash2, Copy, ClipboardPaste, Eraser, Terminal as TerminalIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { isTauri } from "@/lib/utils";
import { formatErrorMessage } from "@/lib/errors";
import type { TerminalShell } from "@/lib/backend/bindings";
import { TerminalConnection } from "./terminalConnection";
import { isTerminalToggle } from "./terminalShortcut";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import { markContextHandled } from "@/lib/contextMenu";

const props = defineProps<{ visible: boolean }>();
const { t } = useI18n();
const workspace = useWorkspaceStore();
const host = ref<HTMLElement | null>(null);
const activeId = ref(0);
const profile = ref<TerminalShell>("default");
const error = ref("");
const menu = ref<{ key: number; x: number; y: number } | null>(null);
const menuPanel = ref<HTMLElement | null>(null);
const menuActions = ["copy", "paste", "selectAll", "clear"] as const;
async function openMenu(event: MouseEvent | KeyboardEvent) {
  if (event instanceof MouseEvent) markContextHandled(event);
  else {
    event.preventDefault();
    event.stopPropagation();
  }
  const session = active.value;
  if (!session) return;
  const rect = session.element.getBoundingClientRect();
  menu.value = {
    key: session.key,
    x: event instanceof MouseEvent ? event.clientX : rect.left + 12,
    y: event instanceof MouseEvent ? event.clientY : rect.top + 12,
  };
  await nextTick();
  menuPanel.value?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}
function closeMenu() {
  menu.value = null;
  if (props.visible) active.value?.terminal.focus();
}
function menuAction(action: (typeof menuActions)[number]) {
  const session = sessions.find((candidate) => candidate.key === menu.value?.key);
  closeMenu();
  if (!session) return;
  if (action === "copy") void copy(session);
  if (action === "paste") void paste(session);
  if (action === "selectAll") session.terminal.selectAll();
  if (action === "clear") session.terminal.clear();
}
function menuKey(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key === "Escape" || event.key === "Tab") {
    event.preventDefault();
    closeMenu();
    return;
  }
  const items = Array.from(
    menuPanel.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
  );
  const index = items.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === "ArrowDown"
      ? (index + 1) % items.length
      : event.key === "ArrowUp"
        ? (index + items.length - 1) % items.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : null;
  if (next !== null) {
    event.preventDefault();
    items[next]?.focus();
  }
}
const desktop = isTauri();
const windows = navigator.userAgent.includes("Windows");
const directory = computed(() => workspace.repoPath || workspace.folderPath);
const sessions = shallowReactive<Session[]>([]);
type Session = {
  key: number;
  cwd: string;
  label: string;
  status: "starting" | "running" | "exited" | "failed";
  code: number | null;
  terminal: Terminal;
  fit: FitAddon;
  connection: TerminalConnection;
  element: HTMLDivElement;
  cancel: (() => void)[];
};
let serial = 0;
let disposed = false;
let observer: ResizeObserver | undefined;
let themeObserver: MutationObserver | undefined;
let frame = 0;
const active = computed(() => sessions.find((session) => session.key === activeId.value));
function update(session: Session, fields: Partial<Session>) {
  Object.assign(session, fields);
}
function showError(reason: unknown) {
  if (!disposed) error.value = formatErrorMessage(reason);
}
function colors() {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: `rgb(${color("--background", "20 20 23")})`,
    foreground: `rgb(${color("--foreground", "225 225 230")})`,
    cursor: `rgb(${color("--foreground", "225 225 230")})`,
    selectionBackground: `rgb(${color("--selection", "55 85 135")})`,
  };
}
function fitActive() {
  frame = 0;
  const session = active.value;
  if (!props.visible || !host.value?.clientWidth || !host.value.clientHeight || !session) return;
  session.fit.fit();
  session.connection.resize(session.terminal.cols, session.terminal.rows);
}
function scheduleFit() {
  if (!frame && !disposed) frame = requestAnimationFrame(fitActive);
}
async function activate(key: number, focus = true) {
  activeId.value = key;
  await nextTick();
  if (disposed) return;
  for (const session of sessions) session.element.hidden = session.key !== key;
  fitActive();
  if (focus && props.visible) active.value?.terminal.focus();
}
async function create() {
  if (!desktop || !directory.value || !host.value || sessions.length >= 16 || disposed) return;
  error.value = "";
  const element = document.createElement("div");
  const shell = profile.value;
  element.className = "h-full min-h-0 overflow-hidden";
  host.value.append(element);
  const terminal = new Terminal({
    cursorBlink: true,
    scrollback: 5000,
    fontSize: 12,
    lineHeight: 1.2,
    fontFamily:
      getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
      "monospace",
    theme: colors(),
    allowProposedApi: false,
    disableStdin: true,
    windowsPty: windows ? { backend: "conpty" } : undefined,
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(element);
  const session = shallowReactive<Session>({
    key: ++serial,
    cwd: directory.value,
    label: windows ? (profile.value === "cmd" ? "cmd" : "PowerShell") : "Shell",
    status: "starting",
    code: null,
    terminal,
    fit,
    element,
    cancel: [],
    connection: undefined!,
  });
  session.connection = new TerminalConnection({
    output: (bytes, done) => terminal.write(bytes, done),
    opened: (info) => {
      terminal.options.disableStdin = false;
      update(session, { label: info.shell, cwd: info.cwd, status: "running" });
    },
    exited: (code) => {
      update(session, { status: "exited", code });
      terminal.options.disableStdin = true;
    },
    error: (reason) => {
      showError(reason);
      if (session.status === "starting") update(session, { status: "failed" });
    },
  });
  const inputSubscription = terminal.onData((data) => session.connection.write(data));
  session.cancel.push(() => inputSubscription.dispose());
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown" || event.isComposing) return true;
    if (isTerminalToggle(event)) return false;
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      void openMenu(event);
      return false;
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && event.shiftKey && event.code === "KeyC") {
      event.preventDefault();
      void copy(session);
      return false;
    }
    if (mod && event.shiftKey && event.code === "KeyV") {
      event.preventDefault();
      void paste(session);
      return false;
    }
    if (event.ctrlKey && event.code === "KeyC" && terminal.hasSelection()) {
      event.preventDefault();
      void copy(session);
      return false;
    }
    return true;
  });
  sessions.push(session);
  await activate(session.key);
  if (!disposed && sessions.includes(session)) {
    void session.connection.start({
      cwd: session.cwd,
      shell,
      cols: terminal.cols,
      rows: terminal.rows,
    });
  }
}
async function close(session: Session) {
  const index = sessions.indexOf(session);
  if (index < 0) return;
  sessions.splice(index, 1);
  session.cancel.forEach((cancel) => cancel());
  const closing = session.connection.close();
  session.terminal.dispose();
  session.element.remove();
  if (activeId.value === session.key)
    await activate(sessions[Math.min(index, sessions.length - 1)]?.key ?? 0);
  await closing;
}
async function copy(session = active.value) {
  if (!session?.terminal.hasSelection()) return;
  try {
    await navigator.clipboard.writeText(session.terminal.getSelection());
  } catch (reason) {
    showError(reason);
  }
}
async function paste(session = active.value) {
  if (!session || session.status !== "running") return;
  try {
    const text = await navigator.clipboard.readText();
    if (disposed || !sessions.includes(session) || session.status !== "running") return;
    session.terminal.paste(text);
    session.terminal.focus();
  } catch (reason) {
    showError(reason);
  }
}
function clear() {
  active.value?.terminal.clear();
  active.value?.terminal.focus();
}
function sessionKey(event: KeyboardEvent, index: number) {
  if (event.isComposing) return;
  const next =
    event.key === "ArrowRight"
      ? (index + 1) % sessions.length
      : event.key === "ArrowLeft"
        ? (index + sessions.length - 1) % sessions.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? sessions.length - 1
            : null;
  if (next === null) return;
  event.preventDefault();
  void activate(sessions[next]!.key, false);
  (event.currentTarget as HTMLElement).parentElement
    ?.querySelector<HTMLButtonElement>(`[data-session-key="${sessions[next]!.key}"]`)
    ?.focus();
}
watch(
  host,
  (element) => {
    observer?.disconnect();
    themeObserver?.disconnect();
    if (!element) return;
    observer = new ResizeObserver(scheduleFit);
    observer.observe(element);
    themeObserver = new MutationObserver(() => {
      for (const session of sessions) session.terminal.options.theme = colors();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-palette", "style"],
    });
  },
  { flush: "post" },
);
watch(
  () => [props.visible, directory.value, host.value] as const,
  async ([visible]) => {
    if (!visible) {
      menu.value = null;
      return;
    }
    await nextTick();
    if (!sessions.length) await create();
    else await activate(activeId.value);
  },
  { immediate: true, flush: "post" },
);
onBeforeUnmount(() => {
  disposed = true;
  observer?.disconnect();
  themeObserver?.disconnect();
  if (frame) cancelAnimationFrame(frame);
  for (const session of sessions.slice()) void close(session);
});
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col text-xs"
    data-terminal-panel
    @keydown="!isTerminalToggle($event) && $event.stopPropagation()"
  >
    <div class="flex min-h-8 flex-wrap items-center gap-1 border-b px-2 py-1">
      <div
        class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        role="tablist"
        :aria-label="t('terminal.sessions')"
      >
        <button
          v-for="(session, index) in sessions"
          :key="session.key"
          type="button"
          role="tab"
          :data-session-key="session.key"
          :aria-selected="activeId === session.key"
          :tabindex="activeId === session.key ? 0 : -1"
          :title="session.cwd"
          class="flex shrink-0 items-center gap-1 rounded px-2 py-1 hover:bg-accent"
          :class="activeId === session.key ? 'bg-accent' : 'text-muted-foreground'"
          @click="activate(session.key)"
          @keydown="sessionKey($event, index)"
        >
          <TerminalIcon class="size-3.5" /> {{ session.key }}: {{ session.label }}
          <span v-if="session.status === 'exited'"
            >({{ t("terminal.exited", { code: session.code ?? "?" }) }})</span
          >
          <span v-else-if="session.status === 'starting'">…</span>
          <span v-else-if="session.status === 'failed'">({{ t("terminal.failed") }})</span>
        </button>
      </div>
      <select
        v-if="windows"
        v-model="profile"
        :aria-label="t('terminal.profile')"
        class="h-6 rounded border bg-background px-1"
      >
        <option value="default">PowerShell</option>
        <option value="cmd">Command Prompt</option>
      </select>
      <button
        type="button"
        :title="t('terminal.new')"
        :aria-label="t('terminal.new')"
        class="rounded p-1 hover:bg-accent disabled:opacity-40"
        :disabled="!desktop || !directory || sessions.length >= 16"
        @click="create"
      >
        <Plus class="size-4" />
      </button>
      <button
        type="button"
        :title="t('terminal.copy')"
        :aria-label="t('terminal.copy')"
        class="rounded p-1 hover:bg-accent disabled:opacity-40"
        :disabled="!active"
        @click="copy()"
      >
        <Copy class="size-3.5" />
      </button>
      <button
        type="button"
        :title="t('terminal.paste')"
        :aria-label="t('terminal.paste')"
        class="rounded p-1 hover:bg-accent disabled:opacity-40"
        :disabled="active?.status !== 'running'"
        @click="paste()"
      >
        <ClipboardPaste class="size-3.5" />
      </button>
      <button
        type="button"
        :title="t('terminal.clear')"
        :aria-label="t('terminal.clear')"
        class="rounded p-1 hover:bg-accent disabled:opacity-40"
        :disabled="!active"
        @click="clear"
      >
        <Eraser class="size-3.5" />
      </button>
      <button
        type="button"
        :title="t('terminal.close')"
        :aria-label="t('terminal.close')"
        class="rounded p-1 hover:bg-accent disabled:opacity-40"
        :disabled="!active"
        @click="active && close(active)"
      >
        <Trash2 class="size-3.5" />
      </button>
    </div>
    <p
      v-if="error"
      role="alert"
      class="max-h-16 overflow-auto break-words px-2 py-1 text-destructive"
    >
      {{ error }}
    </p>
    <p
      v-if="active"
      :title="active.cwd"
      class="truncate px-2 py-0.5 text-[10px] text-muted-foreground"
    >
      {{ t("terminal.startedIn") }} {{ active.cwd }}
    </p>
    <div v-if="!desktop" class="p-4 text-muted-foreground">{{ t("terminal.desktopOnly") }}</div>
    <div v-else-if="!directory && !sessions.length" class="p-4 text-muted-foreground">
      {{ t("terminal.openFolder") }}
    </div>
    <div v-else-if="!sessions.length" class="p-4 text-muted-foreground">
      {{ t("terminal.empty") }}
    </div>
    <div ref="host" data-terminal-host class="min-h-0 flex-1 overflow-hidden p-1" @contextmenu="openMenu" />
    <ContextMenuSurface
      :open="!!menu"
      :anchor-x="menu?.x ?? 0"
      :anchor-y="menu?.y ?? 0"
      :width="230"
      :estimated-height="136"
      @close="closeMenu"
    >
      <div ref="menuPanel" role="menu" :aria-label="t('toolWindows.terminal')" @keydown="menuKey">
        <button
          v-for="action in menuActions"
          :key="action"
          type="button"
          role="menuitem"
          class="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-40"
          :disabled="
            action === 'paste'
              ? active?.status !== 'running'
              : action === 'copy'
                ? !active?.terminal.hasSelection()
                : !active
          "
          @click="menuAction(action)"
        >
          {{ t(`terminal.${action}`) }}
        </button>
      </div>
    </ContextMenuSurface>
  </div>
</template>
