<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Check, GitBranch, Search, Star, Tag } from "@lucide/vue";
import { useBranchesStore } from "@/stores/branchesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { useLogStore } from "@/stores/logStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useSyncStore } from "@/stores/syncStore";
import { openDialog } from "@/composables/useDialog";
import { toast } from "@/composables/useToast";
import ConfirmDialog from "@/components/common/ConfirmDialog.vue";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import NewBranchDialog from "./NewBranchDialog.vue";
import RenameBranchDialog from "./RenameBranchDialog.vue";
import CompareBranchesDialog from "./CompareBranchesDialog.vue";
import { buildRefTree, flattenRefTree } from "./buildRefTree";
import type { RefEntry } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";
import { markContextHandled } from "@/lib/contextMenu";
import { runAction } from "@/actions";

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
const selected = ref<string | null>(null);

const groupByDir = computed(() => settings.settings?.git?.groupBranchesByDirectory ?? true);
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

function openRefMenu(entry: RefEntry | null, e: MouseEvent) {
  if (!entry) return;
  markContextHandled(e);
  menuPos.value = { x: e.clientX, y: e.clientY };
  menuFor.value = entry;
}

function closeMenu() {
  menuFor.value = null;
}


async function afterBranchChange() {
  await changes.refresh();
  await log.load(true);
  await branches.refresh();
}

/** Single click: select + filter Log to this ref (IDEA-like). */
async function onSelect(entry: RefEntry) {
  selected.value = entry.fullName;
  branches.selectedFullName = entry.fullName;
  const rev = entry.kind === "remoteBranch" || entry.kind === "tag" ? entry.name : entry.name;
  log.setRevisions([rev]);
  await log.applyFilters();
}

/** Double click: checkout. */
async function onCheckout(entry: RefEntry) {
  try {
    if ((await branches.checkout(entry)) === false) return;
    toast({ title: t("branches.checkedOut", { name: entry.name }) });
  } catch (e) {
    toast({ title: t("branches.checkoutFailed"), description: formatErrorMessage(e) });
  }
}

async function onNewBranchFrom(entry: RefEntry) {
  const start =
    entry.kind === "tag" ? entry.fullName : entry.kind === "remoteBranch" ? entry.name : entry.name;
  const result = await openDialog<{
    name: string;
    checkout: boolean;
    force: boolean;
  } | null>(NewBranchDialog, { startPoint: start });
  if (!result?.name) return;
  try {
    await branches.createBranch(result.name, start, result.checkout, result.force);
    toast({ title: t("branches.created", { name: result.name }) });
    await afterBranchChange();
  } catch (e) {
    toast({ title: t("branches.createFailed"), description: formatErrorMessage(e) });
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
    toast({ title: t("branches.renamed", { name: result.newName }) });
    await afterBranchChange();
  } catch (e) {
    toast({ title: t("branches.renameFailed"), description: formatErrorMessage(e) });
  }
}

async function onDelete(entry: RefEntry) {
  const ok = await openDialog<boolean>(ConfirmDialog, {
    title: t("branches.deleteConfirm", { name: entry.name }),
    message: t("branches.deleteHint"),
    confirmLabel: t("branches.delete"),
    destructive: true,
  });
  if (!ok) return;
  try {
    if (entry.kind === "remoteBranch") {
      const parts = entry.name.split("/");
      const remote = parts[0] ?? "origin";
      const branch = parts.slice(1).join("/") || entry.name;
      // Push --delete via existing push path is heavy; use remote remove branch if available.
      // Fall back: open remotes for now is worse — call backend via fetch isn't right.
      // Use sync push with delete through a dedicated path if present; else toast.
      await getRemoteDelete(remote, branch);
    } else {
      const sha = await branches.deleteBranch(entry.name, true);
      toast({
        title: t("branches.deleted", { name: entry.name }),
        description: sha ? `SHA ${sha.slice(0, 7)}` : undefined,
        persistent: true,
      });
    }
    await afterBranchChange();
  } catch (e) {
    toast({ title: t("branches.deleteFailed"), description: formatErrorMessage(e) });
  }
}

async function getRemoteDelete(remote: string, branch: string) {
  const { getBackend } = await import("@/lib/backend");
  if (!workspace.repoPath) return;
  await getBackend().remoteDeleteBranch({
    path: workspace.repoPath,
    remote,
    branch,
  });
  toast({ title: t("branches.deleted", { name: `${remote}/${branch}` }) });
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
  toast({ title: t("branches.copied", { name: entry.name }) });
}

async function onMergeIntoCurrent(entry: RefEntry) {
  await rewrite.merge({ branches: [entry.name] });
  await afterBranchChange();
}

async function onRebaseCurrentOnto(entry: RefEntry) {
  await rewrite.rebase({ upstream: entry.name });
  await afterBranchChange();
}

async function onCheckoutAndRebase(entry: RefEntry) {
  const current = branches.refs?.current;
  if (!current) return;
  await rewrite.rebase({ upstream: current, branch: entry.name });
  await afterBranchChange();
}

async function onPullUsing(entry: RefEntry, rebase: boolean) {
  const parts = entry.name.split("/");
  const remote = parts[0] ?? "origin";
  const branch = parts.slice(1).join("/") || entry.name;
  await sync.pull({ remote, branch, rebase });
  await afterBranchChange();
}

async function onPush(entry: RefEntry) {
  await runAction("Git.Push", {
    repoIds: workspace.toplevel ? [workspace.toplevel] : [],
    selection: { refs: [entry.fullName] },
    source: "popup",
    place: "BranchesPane",
    folderPath: workspace.folderPath,
  });
}

function rowClass(entry: RefEntry | undefined) {
  if (!entry) return "hover:bg-accent";
  const active = selected.value === entry.fullName || log.filters.revisions?.includes(entry.name);
  return ["hover:bg-accent", active ? "bg-selection/40" : "", entry.isHead ? "font-medium" : ""];
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col border-r bg-background text-[12.5px]">
    <div class="flex items-center gap-1.5 border-b px-2 py-1.5">
      <Search class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <input
        v-model="branches.search"
        class="h-6 min-w-0 flex-1 bg-transparent text-[12px] outline-none"
        :placeholder="t('branches.search')"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-auto py-1">
      <!-- Local -->
      <div class="px-1">
        <div class="px-2 py-1 text-[11px] font-medium text-primary">
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
            :class="rowClass(row.entry)"
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
              @click="$event.detail < 2 && onSelect(row.entry)"
              @dblclick="onCheckout(row.entry)"
            >
              <GitBranch class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
              <Check v-if="row.entry.isHead" class="h-3 w-3 shrink-0 text-primary" />
              <span class="shrink-0 text-[10px] text-muted-foreground">
                <template v-if="row.entry.behind">↓{{ row.entry.behind }}</template>
                <template v-if="row.entry.ahead">↑{{ row.entry.ahead }}</template>
              </span>
            </button>
          </div>
        </template>
        <div
          v-if="!branches.filteredLocal.length"
          class="px-2 py-1 text-[11px] text-muted-foreground"
        >
          —
        </div>
      </div>

      <!-- Remote -->
      <div class="mt-1 px-1">
        <div class="px-2 py-1 text-[11px] font-medium text-primary">
          {{ t("branches.remote") }}
        </div>
        <button
          v-for="entry in branches.filteredRemote"
          :key="entry.fullName"
          type="button"
          class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left"
          :class="rowClass(entry)"
          @click="onSelect(entry)"
          @dblclick="onCheckout(entry)"
          @contextmenu="openRefMenu(entry, $event)"
        >
          <GitBranch class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
        </button>
        <button
          v-if="!branches.filteredRemote.length"
          type="button"
          class="px-2 py-1 text-left text-[11px] text-muted-foreground hover:text-foreground"
          @click="
            runAction('Git.Configure.Remotes', {
              repoIds: workspace.toplevel ? [workspace.toplevel] : [],
              selection: {},
              source: 'popup',
              place: 'BranchesPane',
              folderPath: workspace.folderPath,
            })
          "
        >
          {{ t("branches.noRemotes") }}
        </button>
      </div>

      <!-- Tags -->
      <div v-if="showTags" class="mt-1 px-1">
        <div class="px-2 py-1 text-[11px] font-medium text-primary">
          {{ t("branches.tags") }}
        </div>
        <button
          v-for="entry in branches.filteredTags"
          :key="entry.fullName"
          type="button"
          class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left"
          :class="rowClass(entry)"
          @click="onSelect(entry)"
          @dblclick="onCheckout(entry)"
          @contextmenu="openRefMenu(entry, $event)"
        >
          <Tag class="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span class="min-w-0 flex-1 truncate">{{ entry.name }}</span>
        </button>
      </div>
    </div>

    <ContextMenuSurface
      :open="!!menuFor"
      :anchor-x="menuPos.x"
      :anchor-y="menuPos.y"
      :width="280"
      :estimated-height="380"
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
            onPush(menuFor);
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
          v-if="
            (menuFor.kind === 'localBranch' && !menuFor.isHead) || menuFor.kind === 'remoteBranch'
          "
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
  </div>
</template>
