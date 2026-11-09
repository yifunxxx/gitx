<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { GitBranch, RefreshCw, Search, Settings2, Star, Tag } from "@lucide/vue";
import { Button } from "@/components/ui/button";
import { useBranchesStore } from "@/stores/branchesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { useLogStore } from "@/stores/logStore";
import { openDialog } from "@/composables/useDialog";
import { toast } from "@/composables/useToast";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import NewBranchDialog from "./NewBranchDialog.vue";
import RenameBranchDialog from "./RenameBranchDialog.vue";
import CompareBranchesDialog from "./CompareBranchesDialog.vue";
import CreateTagDialog from "./CreateTagDialog.vue";
import { buildRefTree, flattenRefTree } from "./buildRefTree";
import type { RefEntry } from "@/lib/backend";
import { runAction } from "@/actions";
import type { ActionContext } from "@/actions";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useSyncStore } from "@/stores/syncStore";
import { formatErrorMessage } from "@/lib/errors";
import { markContextHandled } from "@/lib/contextMenu";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";

const { t } = useI18n();
const branches = useBranchesStore();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const changes = useChangesStore();
const log = useLogStore();
const rewrite = useRewriteStore();
const sync = useSyncStore();

const menuFor = ref<RefEntry | null>(null);
const menuPos = ref({ x: 0, y: 0 });

function openRefMenu(entry: RefEntry | null, e: MouseEvent) {
  if (!entry) return;
  markContextHandled(e);
  menuPos.value = { x: e.clientX, y: e.clientY };
  menuFor.value = entry;
}

function closeMenu() {
  menuFor.value = null;
}

const actionCtx = computed<ActionContext>(() => ({
  repoIds: workspace.toplevel ? [workspace.toplevel] : [],
  selection: {},
  source: "popup",
  place: "BranchesPopup",
  folderPath: workspace.folderPath,
}));

async function runPopupAction(id: string) {
  await runAction(id, actionCtx.value);
}
const groupByDir = computed(() => settings.settings?.git?.groupBranchesByDirectory ?? true);
const showRecent = computed(() => settings.settings?.git?.showRecentBranches ?? true);
const showTags = computed(() => settings.settings?.git?.showTags ?? true);

const localRefs = computed(
  () => new Map(branches.filteredLocal.map((entry) => [entry.name, entry])),
);
const localRows = computed(() =>
  flattenRefTree(
    buildRefTree(
      branches.filteredLocal.map((entry) => entry.name),
      groupByDir.value,
    ),
  ).map((row) => ({ ...row, entry: localRefs.value.get(row.refName ?? row.id) })),
);

onMounted(() => {
  void branches.refresh();
});

watch(
  () => branches.popupOpen,
  (open) => {
    if (open) void branches.refresh();
  },
);

async function afterBranchChange() {
  await changes.refresh();
  await log.load(true);
  await branches.refresh();
}

async function onCheckout(entry: RefEntry) {
  try {
    await branches.checkout(entry);
    toast({ title: `Checked out ${entry.name}` });
    await afterBranchChange();
    branches.closePopup();
  } catch (e) {
    toast({ title: "Checkout failed", description: formatErrorMessage(e) });
  }
}

async function onNewBranch() {
  await onNewBranchFromPoint(branches.refs?.current ?? "HEAD");
}

async function onNewBranchFrom(entry: RefEntry) {
  const start =
    entry.kind === "tag" ? entry.fullName : entry.kind === "remoteBranch" ? entry.name : entry.name;
  await onNewBranchFromPoint(start);
}

async function onNewBranchFromPoint(start: string) {
  const result = await openDialog<{
    name: string;
    checkout: boolean;
    force: boolean;
  } | null>(NewBranchDialog, { startPoint: start });
  if (!result?.name) return;
  try {
    await branches.createBranch(result.name, start, result.checkout, result.force);
    toast({ title: `Created ${result.name}` });
    await afterBranchChange();
  } catch (e) {
    toast({ title: "Create branch failed", description: formatErrorMessage(e) });
  }
}

async function onRename(entry: RefEntry) {
  const result = await openDialog<{
    newName: string;
    unsetUpstream: boolean;
  } | null>(RenameBranchDialog, {
    oldName: entry.name,
    hasUpstream: !!entry.upstream,
  });
  if (!result?.newName) return;
  try {
    await branches.renameBranch(entry.name, result.newName, result.unsetUpstream);
    toast({ title: `Renamed to ${result.newName}` });
    await afterBranchChange();
  } catch (e) {
    toast({ title: "Rename failed", description: formatErrorMessage(e) });
  }
}

async function onDelete(entry: RefEntry) {
  const ok = await openDialog<boolean>(ConfirmDialog, {
    title: `Delete branch '${entry.name}'?`,
    message: "Not fully merged branches can be restored from the notification.",
    confirmLabel: "Delete",
    destructive: true,
  });
  if (!ok) return;
  try {
    const sha = await branches.deleteBranch(entry.name, true);
    toast({
      title: `Deleted ${entry.name}`,
      description: sha ? `Restore available (${sha.slice(0, 7)})` : undefined,
      persistent: true,
    });
    await afterBranchChange();
  } catch (e) {
    toast({ title: "Delete failed", description: formatErrorMessage(e) });
  }
}

async function onCompare(entry: RefEntry) {
  const current = branches.refs?.current ?? "HEAD";
  await openDialog(CompareBranchesDialog, {
    left: current,
    right: entry.name,
  });
}

async function onCopy(entry: RefEntry) {
  await navigator.clipboard.writeText(entry.name);
  toast({ title: `Copied '${entry.name}'` });
}

async function onFetch() {
  try {
    const summary = await branches.fetch();
    if (summary) toast({ title: summary.message || "Fetched" });
  } catch {
    // Toast already shown by branchesStore.
  }
}

async function onNewTag() {
  await openDialog(CreateTagDialog, {
    target: branches.refs?.current ?? "HEAD",
  });
  await branches.refresh();
}

function findLocal(name: string): RefEntry | undefined {
  return localRefs.value.get(name);
}

async function onMergeIntoCurrent(entry: RefEntry) {
  await rewrite.merge({ branches: [entry.name] });
  await afterBranchChange();
  branches.closePopup();
}

async function onRebaseCurrentOnto(entry: RefEntry) {
  await rewrite.rebase({ upstream: entry.name });
  await afterBranchChange();
  branches.closePopup();
}

async function onCheckoutAndRebase(entry: RefEntry) {
  const current = branches.refs?.current;
  if (!current) return;
  // git rebase <current> <entry> checks out entry and rebases onto current
  await rewrite.rebase({ upstream: current, branch: entry.name });
  await afterBranchChange();
  branches.closePopup();
}

async function onPullUsing(entry: RefEntry, rebase: boolean) {
  const parts = entry.name.split("/");
  const remote = parts[0] ?? "origin";
  const branch = parts.slice(1).join("/") || entry.name;
  await sync.pull({ remote, branch, rebase });
  await afterBranchChange();
  branches.closePopup();
}
</script>

<template>
  <div
    v-if="branches.popupOpen"
    class="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
    @click.self="branches.closePopup()"
    @keydown.esc="branches.closePopup()"
  >
    <div
      class="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border bg-popover shadow-lg ring-1 ring-foreground/10"
      role="dialog"
      aria-label="Branches"
    >
      <div class="flex items-center gap-2 border-b px-3 py-2">
        <Search class="h-3.5 w-3.5 text-muted-foreground" />
        <input
          v-model="branches.search"
          class="h-7 flex-1 bg-transparent text-sm outline-none"
          placeholder="Search branches…"
          autofocus
        />
        <Button variant="ghost" size="icon" title="Fetch" @click="onFetch">
          <RefreshCw class="h-3.5 w-3.5" :class="{ 'animate-spin': branches.loading }" />
        </Button>
        <Button variant="ghost" size="icon" title="Branch display options" disabled>
          <Settings2 class="h-3.5 w-3.5" />
        </Button>
      </div>

      <div class="flex flex-wrap gap-1 border-b px-2 py-1.5">
        <Button size="xs" variant="ghost" @click="runPopupAction('Vcs.UpdateProject')"
          >Update Project…</Button
        >
        <Button size="xs" variant="ghost" @click="runPopupAction('CheckinProject')">Commit…</Button>
        <Button size="xs" variant="ghost" @click="runPopupAction('Git.Push')">Push…</Button>
        <Button size="xs" variant="ghost" @click="onNewBranch">New Branch…</Button>
        <Button size="xs" variant="ghost" @click="onNewTag">New Tag…</Button>
        <Button size="xs" variant="ghost" @click="runPopupAction('Git.Configure.Remotes')"
          >Remotes…</Button
        >
      </div>

      <div class="min-h-0 flex-1 overflow-auto text-sm">
        <div v-if="showRecent && branches.refs?.recent?.length" class="px-2 py-1">
          <div class="px-1 py-1 text-[11px] font-medium uppercase text-muted-foreground">
            Recent
          </div>
          <button
            v-for="name in branches.refs.recent"
            :key="'r-' + name"
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-accent"
            @click="findLocal(name) && onCheckout(findLocal(name)!)"
          >
            <GitBranch class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="truncate">{{ name }}</span>
          </button>
        </div>

        <div class="px-2 py-1">
          <div class="px-1 py-1 text-[11px] font-medium uppercase text-muted-foreground">
            {{ t("branches.local") }}
          </div>
          <template v-for="row in localRows" :key="row.id">
            <div
              v-if="row.kind === 'folder'"
              class="truncate py-0.5 pr-2 text-[11px] text-muted-foreground"
              :style="{ paddingLeft: `${8 + Math.min(row.depth, 6) * 12}px` }"
              :title="row.id"
            >
              {{ row.label }}/
            </div>
            <div
              v-else-if="row.entry"
              class="flex w-full items-center gap-1.5 rounded pr-2 text-left hover:bg-accent"
              :style="{ paddingLeft: `${8 + Math.min(row.depth, 6) * 12}px` }"
              :class="{ 'font-medium': row.entry.isHead }"
              @contextmenu="openRefMenu(row.entry, $event)"
            >
              <button
                type="button"
                class="shrink-0 rounded py-1 text-muted-foreground hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="t('branches.toggleFavorite', { name: row.entry.name })"
                :aria-pressed="row.entry.isFavorite"
                @click.stop="$event.detail < 2 && branches.toggleFavorite(row.entry)"
              >
                <Star
                  class="h-3 w-3"
                  :class="row.entry.isFavorite ? 'fill-current text-warning' : ''"
                />
              </button>
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 rounded py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                :aria-label="row.entry.name"
                :title="row.entry.name"
                @click="$event.detail < 2 && onCheckout(row.entry)"
              >
                <GitBranch class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
                <span v-if="row.entry.isHead" class="rounded bg-muted px-1 text-[10px]">HEAD</span>
                <span class="shrink-0 text-[10px] text-muted-foreground">
                  <template v-if="row.entry.behind">↓{{ row.entry.behind }}</template>
                  <template v-if="row.entry.ahead">↑{{ row.entry.ahead }}</template>
                </span>
              </button>
            </div>
          </template>
        </div>

        <div class="px-2 py-1">
          <div class="px-1 py-1 text-[11px] font-medium uppercase text-muted-foreground">
            {{ t("branches.remote") }}
          </div>
          <button
            v-for="entry in branches.filteredRemote"
            :key="entry.fullName"
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-accent"
            @click="onCheckout(entry)"
            @contextmenu="openRefMenu(entry, $event)"
          >
            <GitBranch class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="truncate">{{ entry.name }}</span>
          </button>
          <div
            v-if="!branches.filteredRemote.length"
            class="px-2 py-1 text-[11px] text-muted-foreground"
          >
            {{ t("branches.noRemotes") }}
          </div>
        </div>

        <div v-if="showTags" class="px-2 py-1">
          <div class="px-1 py-1 text-[11px] font-medium uppercase text-muted-foreground">
            {{ t("branches.tags") }}
          </div>
          <button
            v-for="entry in branches.filteredTags"
            :key="entry.fullName"
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-accent"
            @click="onCheckout(entry)"
            @contextmenu="openRefMenu(entry, $event)"
          >
            <Tag class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="truncate">{{ entry.name }}</span>
          </button>
        </div>
      </div>

      <ContextMenuSurface
        :open="!!menuFor"
        :anchor-x="menuPos.x"
        :anchor-y="menuPos.y"
        :width="260"
        :estimated-height="320"
        @close="closeMenu"
      >
        <template v-if="menuFor">
          <button
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="
              onCheckout(menuFor);
              closeMenu();
            "
          >
            {{ t("branches.checkout") }}
          </button>
          <button
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="
              onNewBranchFrom(menuFor);
              closeMenu();
            "
          >
            {{ t("branches.newBranchFrom", { name: menuFor.name }) }}
          </button>
          <button
            v-if="menuFor.kind === 'localBranch'"
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="
              onRename(menuFor);
              closeMenu();
            "
          >
            {{ t("branches.rename") }}
          </button>
          <button
            v-if="!menuFor.isHead"
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="
              onMergeIntoCurrent(menuFor);
              closeMenu();
            "
          >
            {{ t("branches.mergeIntoCurrent", { name: menuFor.name }) }}
          </button>
          <button
            v-if="!menuFor.isHead"
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="
              onRebaseCurrentOnto(menuFor);
              closeMenu();
            "
          >
            {{ t("branches.rebaseOnto", { name: menuFor.name }) }}
          </button>
          <button
            v-if="menuFor.kind === 'localBranch' && !menuFor.isHead"
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="
              onCheckoutAndRebase(menuFor);
              closeMenu();
            "
          >
            {{ t("branches.checkoutAndRebase") }}
          </button>
          <button
            v-if="menuFor.kind === 'localBranch'"
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="
              runPopupAction('Git.Push');
              closeMenu();
            "
          >
            {{ t("branches.push") }}
          </button>
          <button
            v-if="menuFor.kind === 'remoteBranch'"
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="
              onPullUsing(menuFor, false);
              closeMenu();
            "
          >
            {{ t("branches.pullMerge") }}
          </button>
          <button
            v-if="menuFor.kind === 'remoteBranch'"
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="
              onPullUsing(menuFor, true);
              closeMenu();
            "
          >
            {{ t("branches.pullRebase") }}
          </button>
          <button
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="
              onCompare(menuFor);
              closeMenu();
            "
          >
            {{ t("branches.compareWithCurrent") }}
          </button>
          <button
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="
              onCopy(menuFor);
              closeMenu();
            "
          >
            {{ t("branches.copyName") }}
          </button>
          <button
            v-if="menuFor.kind === 'localBranch' && !menuFor.isHead"
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm text-destructive hover:bg-accent"
            @click="
              onDelete(menuFor);
              closeMenu();
            "
          >
            {{ t("branches.delete") }}
          </button>
          <button
            type="button"
            class="block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent"
            @click="closeMenu()"
          >
            {{ t("common.close") }}
          </button>
        </template>
      </ContextMenuSurface>

      <div class="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        {{ workspace.repoPath ?? "No repository" }}
      </div>
    </div>
  </div>
</template>
