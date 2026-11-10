<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import VirtualList from "@/components/common/VirtualList.vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { useBranchesStore } from "@/stores/branchesStore";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const branches = useBranchesStore();
const rewrite = useRewriteStore();
const workspace = useWorkspaceStore();

const selected = ref<string[]>([]);
const noFf = ref(false);
const ffOnly = ref(false);
const squash = ref(false);
const noCommit = ref(false);
const noVerify = ref(false);
const allowUnrelated = ref(false);
const message = ref("");
const customMessage = ref(false);

const otherBranches = computed(() => branches.refs?.local.filter((b) => !b.isHead) ?? []);
const head = computed(() => workspace.branch?.head ?? "HEAD");

const preview = computed(() => {
  const opts = ["merge"];
  if (noFf.value) opts.push("--no-ff");
  if (ffOnly.value) opts.push("--ff-only");
  if (squash.value) opts.push("--squash");
  if (noCommit.value) opts.push("--no-commit");
  if (noVerify.value) opts.push("--no-verify");
  if (allowUnrelated.value) opts.push("--allow-unrelated-histories");
  if (customMessage.value && message.value) opts.push("-m", JSON.stringify(message.value));
  else opts.push("--no-edit");
  opts.push(...selected.value);
  return `git ${opts.join(" ")}`;
});

onMounted(async () => {
  await branches.refresh();
  const locals = branches.refs?.local.filter((b) => !b.isHead).map((b) => b.name) ?? [];
  if (locals[0]) selected.value = [locals[0]];
});

function toggleBranch(name: string) {
  if (selected.value.includes(name)) {
    selected.value = selected.value.filter((n) => n !== name);
  } else {
    selected.value = [...selected.value, name];
  }
}

async function ok() {
  if (!selected.value.length) return;
  await rewrite.merge({
    branches: selected.value,
    noFf: noFf.value,
    ffOnly: ffOnly.value,
    squash: squash.value,
    message: customMessage.value ? message.value : null,
    noCommit: noCommit.value,
    noVerify: noVerify.value,
    allowUnrelated: allowUnrelated.value,
  });
  closeDialog(true);
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div
      class="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 class="text-sm font-semibold">Merge</h2>
      <p class="mt-1 text-xs text-muted-foreground">Merge into '{{ head }}'</p>
      <VirtualList
        class="mt-3 shrink-0 rounded border"
        :style="{ height: `${Math.max(1, Math.min(otherBranches.length, 8)) * 30}px` }"
        :items="otherBranches"
        :item-height="30"
        :get-key="(b) => b.name"
      >
        <template #default="{ item: b }">
          <button
            type="button"
            class="flex h-full w-full min-w-0 items-center gap-2 border-b px-2 text-left text-xs last:border-b-0 hover:bg-accent"
            @click="toggleBranch(b.name)"
          >
            <input type="checkbox" :checked="selected.includes(b.name)" readonly />
            <span class="truncate font-mono" :title="b.name">{{ b.name }}</span>
          </button>
        </template>
        <template #footer
          ><div v-if="!otherBranches.length" class="p-3 text-xs text-muted-foreground">
            No other local branches
          </div></template
        >
      </VirtualList>
      <div class="mt-3 text-[11px] font-medium text-muted-foreground">Modify options</div>
      <div class="mt-1 grid grid-cols-2 gap-1 text-xs">
        <label class="flex items-center gap-2"
          ><input v-model="noFf" type="checkbox" :disabled="ffOnly" /> --no-ff</label
        >
        <label class="flex items-center gap-2"
          ><input v-model="ffOnly" type="checkbox" :disabled="noFf || squash" /> --ff-only</label
        >
        <label class="flex items-center gap-2"
          ><input v-model="squash" type="checkbox" :disabled="ffOnly" /> --squash</label
        >
        <label class="flex items-center gap-2"
          ><input v-model="noCommit" type="checkbox" /> --no-commit</label
        >
        <label class="flex items-center gap-2"
          ><input v-model="noVerify" type="checkbox" /> --no-verify</label
        >
        <label class="flex items-center gap-2"
          ><input v-model="allowUnrelated" type="checkbox" /> --allow-unrelated-histories</label
        >
        <label class="col-span-2 flex items-center gap-2"
          ><input v-model="customMessage" type="checkbox" /> -m message</label
        >
      </div>
      <input
        v-if="customMessage"
        v-model="message"
        class="mt-2 h-8 w-full rounded-md border bg-background px-2 text-sm"
        placeholder="Merge message"
      />
      <div class="mt-3 rounded bg-muted px-2 py-1 font-mono text-[11px]">{{ preview }}</div>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">Cancel</Button>
        <Button size="sm" :disabled="!selected.length" @click="ok">Merge</Button>
      </div>
    </div>
  </div>
</template>
