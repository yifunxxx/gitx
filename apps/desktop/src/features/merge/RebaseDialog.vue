<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog, openDialog } from "@/composables/useDialog";
import { useBranchesStore } from "@/stores/branchesStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import InteractiveRebaseEditor from "@/features/merge/InteractiveRebaseEditor.vue";

const branches = useBranchesStore();
const rewrite = useRewriteStore();
const workspace = useWorkspaceStore();

const upstream = ref("");
const onto = ref("");
const useOnto = ref(false);
const switchBranch = ref("");
const rebaseMerges = ref(false);
const keepEmpty = ref(false);
const root = ref(false);
const updateRefs = ref(false);
const autosquash = ref(false);
const interactive = ref(false);

const head = computed(() => workspace.branch?.head ?? "HEAD");

const preview = computed(() => {
  const opts = ["rebase"];
  if (interactive.value) opts.push("-i");
  if (rebaseMerges.value) opts.push("--rebase-merges");
  if (keepEmpty.value) opts.push("--keep-empty");
  if (root.value) opts.push("--root");
  if (updateRefs.value) opts.push("--update-refs");
  if (autosquash.value) opts.push("--autosquash");
  if (useOnto.value && onto.value) opts.push("--onto", onto.value);
  if (!root.value) opts.push(upstream.value || "<upstream>");
  if (switchBranch.value) opts.push(switchBranch.value);
  return `git ${opts.join(" ")}`;
});

onMounted(async () => {
  await branches.refresh();
  const locals = branches.refs?.local.filter((b) => !b.isHead).map((b) => b.name) ?? [];
  const remotes = branches.refs?.remote.map((b) => b.name) ?? [];
  upstream.value = remotes[0] ?? locals[0] ?? "main";
});

async function ok() {
  if (!root.value && !upstream.value) return;
  if (interactive.value) {
    closeDialog(false);
    await openDialog(InteractiveRebaseEditor, { upstream: upstream.value });
    return;
  }
  await rewrite.rebase({
    upstream: upstream.value,
    onto: useOnto.value ? onto.value : null,
    branch: switchBranch.value || null,
    rebaseMerges: rebaseMerges.value,
    keepEmpty: keepEmpty.value,
    root: root.value,
    updateRefs: updateRefs.value,
    autosquash: autosquash.value,
    interactive: false,
  });
  closeDialog(true);
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-lg rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Rebase</h2>
      <p class="mt-1 text-xs text-muted-foreground">Current branch: {{ head }}</p>
      <div class="mt-3 grid gap-2">
        <label class="text-[11px] text-muted-foreground">Upstream
          <input v-model="upstream" class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm" :disabled="root" />
        </label>
        <label class="flex items-center gap-2 text-xs">
          <input v-model="useOnto" type="checkbox" /> --onto
          <input v-model="onto" class="h-7 flex-1 rounded-md border bg-background px-2 text-sm" :disabled="!useOnto" placeholder="onto ref" />
        </label>
        <label class="text-[11px] text-muted-foreground">Switch to another branch (optional)
          <input v-model="switchBranch" class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm" placeholder="branch to rebase" />
        </label>
      </div>
      <div class="mt-3 text-[11px] font-medium text-muted-foreground">Modify options</div>
      <div class="mt-1 grid grid-cols-2 gap-1 text-xs">
        <label class="flex items-center gap-2"><input v-model="interactive" type="checkbox" /> --interactive</label>
        <label class="flex items-center gap-2"><input v-model="rebaseMerges" type="checkbox" /> --rebase-merges</label>
        <label class="flex items-center gap-2"><input v-model="keepEmpty" type="checkbox" /> --keep-empty</label>
        <label class="flex items-center gap-2"><input v-model="root" type="checkbox" /> --root</label>
        <label class="flex items-center gap-2"><input v-model="updateRefs" type="checkbox" /> --update-refs</label>
        <label class="flex items-center gap-2"><input v-model="autosquash" type="checkbox" /> --autosquash</label>
      </div>
      <p v-if="interactive" class="mt-2 text-[11px] text-muted-foreground">
        Opens the interactive rebase editor for the commits after upstream.
      </p>
      <div class="mt-3 rounded bg-muted px-2 py-1 font-mono text-[11px]">{{ preview }}</div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">Cancel</Button>
        <Button size="sm" :disabled="!root && !upstream" @click="ok">
          {{ interactive ? "Edit…" : "Rebase" }}
        </Button>
      </div>
    </div>
  </div>
</template>
