<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import {
  GitBranch,
  RefreshCw,
  Search,
  Settings2,
  Star,
  Tag,
} from "@lucide/vue";
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
import { buildRefTree } from "./buildRefTree";
import type { RefEntry } from "@/lib/backend";
import { runAction } from "@/actions";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useSyncStore } from "@/stores/syncStore";
import { formatErrorMessage } from "@/lib/errors";

const branches = useBranchesStore();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const changes = useChangesStore();
const log = useLogStore();
const rewrite = useRewriteStore();
const sync = useSyncStore();

const menuFor = ref<RefEntry | null>(null);
const groupByDir = computed(
  () => settings.settings?.git?.groupBranchesByDirectory ?? true,
);
const showRecent = computed(() => settings.settings?.git?.showRecentBranches ?? true);
const showTags = computed(() => settings.settings?.git?.showTags ?? true);

const localTree = computed(() =>
  buildRefTree(
    branches.filteredLocal.map((r) => r.name),
    groupByDir.value,
  ),
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
  const start = branches.refs?.current ?? "HEAD";
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
  const summary = await branches.fetch();
  toast({ title: summary?.message ?? "Fetched" });
}

async function onNewTag() {
  await openDialog(CreateTagDialog, {
    target: branches.refs?.current ?? "HEAD",
  });
  await branches.refresh();
}

function findLocal(name: string): RefEntry | undefined {
  return branches.filteredLocal.find((r) => r.name === name);
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
        <Button size="xs" variant="ghost" @click="runAction('Vcs.UpdateProject')">Update Project…</Button>
        <Button size="xs" variant="ghost" @click="runAction('CheckinProject')">Commit…</Button>
        <Button size="xs" variant="ghost" @click="runAction('Git.Push')">Push…</Button>
        <Button size="xs" variant="ghost" @click="onNewBranch">New Branch…</Button>
        <Button size="xs" variant="ghost" @click="onNewTag">New Tag…</Button>
        <Button size="xs" variant="ghost" @click="runAction('Git.Configure.Remotes')">Remotes…</Button>
      </div>

      <div class="min-h-0 flex-1 overflow-auto text-sm">
        <div v-if="showRecent && branches.refs?.recent?.length" class="px-2 py-1">
          <div class="px-1 py-1 text-[11px] font-medium uppercase text-muted-foreground">Recent</div>
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
          <div class="px-1 py-1 text-[11px] font-medium uppercase text-muted-foreground">Local</div>
          <template v-for="node in localTree" :key="node.id">
            <div v-if="node.kind === 'folder'" class="px-2 py-0.5 text-[11px] text-muted-foreground">
              {{ node.label }}/
            </div>
            <button
              v-for="child in node.kind === 'folder' ? node.children ?? [] : [node]"
              :key="child.id"
              type="button"
              class="flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-accent"
              :class="{ 'font-medium': findLocal(child.refName ?? child.id)?.isHead }"
              @click="findLocal(child.refName ?? child.id) && onCheckout(findLocal(child.refName ?? child.id)!)"
              @contextmenu.prevent="menuFor = findLocal(child.refName ?? child.id) ?? null"
            >
              <button
                type="button"
                class="text-muted-foreground hover:text-warning"
                @click.stop="findLocal(child.refName ?? child.id) && branches.toggleFavorite(findLocal(child.refName ?? child.id)!)"
              >
                <Star
                  class="h-3 w-3"
                  :class="findLocal(child.refName ?? child.id)?.isFavorite ? 'fill-current text-warning' : ''"
                />
              </button>
              <GitBranch class="h-3.5 w-3.5 text-muted-foreground" />
              <span class="truncate">{{ child.label }}</span>
              <span
                v-if="findLocal(child.refName ?? child.id)?.isHead"
                class="rounded bg-muted px-1 text-[10px]"
              >HEAD</span>
              <span class="ml-auto text-[11px] text-muted-foreground">
                <template v-if="findLocal(child.refName ?? child.id)?.behind">↓{{ findLocal(child.refName ?? child.id)?.behind }}</template>
                <template v-if="findLocal(child.refName ?? child.id)?.ahead">↑{{ findLocal(child.refName ?? child.id)?.ahead }}</template>
              </span>
            </button>
          </template>
        </div>

        <div class="px-2 py-1">
          <div class="px-1 py-1 text-[11px] font-medium uppercase text-muted-foreground">Remote</div>
          <button
            v-for="entry in branches.filteredRemote"
            :key="entry.fullName"
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-accent"
            @click="onCheckout(entry)"
            @contextmenu.prevent="menuFor = entry"
          >
            <GitBranch class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="truncate">{{ entry.name }}</span>
          </button>
          <div v-if="!branches.filteredRemote.length" class="px-2 py-1 text-[11px] text-muted-foreground">
            No remotes — Manage Remotes…
          </div>
        </div>

        <div v-if="showTags" class="px-2 py-1">
          <div class="px-1 py-1 text-[11px] font-medium uppercase text-muted-foreground">Tags</div>
          <button
            v-for="entry in branches.filteredTags"
            :key="entry.fullName"
            type="button"
            class="flex w-full items-center gap-2 rounded px-2 py-1 hover:bg-accent"
            @click="onCheckout(entry)"
            @contextmenu.prevent="menuFor = entry"
          >
            <Tag class="h-3.5 w-3.5 text-muted-foreground" />
            <span class="truncate">{{ entry.name }}</span>
          </button>
        </div>
      </div>

      <div
        v-if="menuFor"
        class="absolute z-[70] min-w-48 rounded-md border bg-popover p-1 text-sm shadow-lg"
        style="top: 40%; left: 50%; transform: translate(-50%, -50%)"
      >
        <button type="button" class="block w-full rounded px-2 py-1 text-left hover:bg-accent" @click="onCheckout(menuFor!); menuFor = null">Checkout</button>
        <button v-if="menuFor.kind === 'localBranch'" type="button" class="block w-full rounded px-2 py-1 text-left hover:bg-accent" @click="onRename(menuFor!); menuFor = null">Rename…</button>
        <button
          v-if="!menuFor.isHead"
          type="button"
          class="block w-full rounded px-2 py-1 text-left hover:bg-accent"
          @click="onMergeIntoCurrent(menuFor!); menuFor = null"
        >
          Merge '{{ menuFor.name }}' into Current
        </button>
        <button
          v-if="!menuFor.isHead"
          type="button"
          class="block w-full rounded px-2 py-1 text-left hover:bg-accent"
          @click="onRebaseCurrentOnto(menuFor!); menuFor = null"
        >
          Rebase Current onto '{{ menuFor.name }}'
        </button>
        <button
          v-if="menuFor.kind === 'localBranch' && !menuFor.isHead"
          type="button"
          class="block w-full rounded px-2 py-1 text-left hover:bg-accent"
          @click="onCheckoutAndRebase(menuFor!); menuFor = null"
        >
          Checkout and Rebase onto Current
        </button>
        <button
          v-if="menuFor.kind === 'remoteBranch'"
          type="button"
          class="block w-full rounded px-2 py-1 text-left hover:bg-accent"
          @click="onPullUsing(menuFor!, false); menuFor = null"
        >
          Pull into Current Using Merge
        </button>
        <button
          v-if="menuFor.kind === 'remoteBranch'"
          type="button"
          class="block w-full rounded px-2 py-1 text-left hover:bg-accent"
          @click="onPullUsing(menuFor!, true); menuFor = null"
        >
          Pull into Current Using Rebase
        </button>
        <button type="button" class="block w-full rounded px-2 py-1 text-left hover:bg-accent" @click="onCompare(menuFor!); menuFor = null">Compare with current</button>
        <button type="button" class="block w-full rounded px-2 py-1 text-left hover:bg-accent" @click="onCopy(menuFor!); menuFor = null">Copy Branch Name</button>
        <button v-if="menuFor.kind === 'localBranch' && !menuFor.isHead" type="button" class="block w-full rounded px-2 py-1 text-left text-destructive hover:bg-accent" @click="onDelete(menuFor!); menuFor = null">Delete</button>
        <button type="button" class="block w-full rounded px-2 py-1 text-left hover:bg-accent" @click="menuFor = null">Close</button>
      </div>

      <div class="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
        {{ workspace.repoPath ?? "No repository" }}
      </div>
    </div>
  </div>
</template>
