<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { closeDialog } from "@/composables/useDialog";
import { useRewriteStore } from "@/stores/rewriteStore";
import type { RebasePlan, RebaseTodoAction } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";

const props = defineProps<{
  /** First commit to include (Log “from here”). */
  fromSha?: string;
  /** Exclusive upstream base (Rebase dialog --interactive). */
  upstream?: string;
}>();
const rewrite = useRewriteStore();

const plan = ref<RebasePlan | null>(null);
const error = ref<string | null>(null);
const selected = ref(0);

const actions: RebaseTodoAction[] = ["pick", "reword", "edit", "squash", "fixup", "drop"];

onMounted(async () => {
  try {
    const seed = props.upstream ?? props.fromSha;
    if (!seed) throw new Error("fromSha or upstream required");
    const p = await rewrite.loadInteractivePlan(seed, !!props.upstream);
    if (!p) throw new Error("Failed to load plan");
    plan.value = {
      ...p,
      items: p.items.map((it) => ({ ...it, message: it.message ?? "" })),
    };
  } catch (e: unknown) {
    error.value = formatErrorMessage(e);
  }
});

function move(delta: number) {
  if (!plan.value) return;
  const i = selected.value;
  const j = i + delta;
  if (j < 0 || j >= plan.value.items.length) return;
  const items = [...plan.value.items];
  const tmp = items[i]!;
  items[i] = items[j]!;
  items[j] = tmp;
  plan.value = { ...plan.value, items };
  selected.value = j;
}

function resetActions() {
  if (!plan.value) return;
  plan.value = {
    ...plan.value,
    items: plan.value.items.map((it) => ({ ...it, action: "pick" as const, message: "" })),
  };
}

async function start() {
  if (!plan.value) return;
  const toSend: RebasePlan = {
    ...plan.value,
    items: plan.value.items.map((it) => ({
      ...it,
      message: it.message && String(it.message).trim() ? it.message : null,
    })),
  };
  await rewrite.startInteractive(toSend);
  closeDialog(true);
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Interactive Rebase</h2>
      <p class="mt-1 text-xs text-muted-foreground">
        Set actions, reorder with ↑/↓, then Start Rebasing.
      </p>
      <p v-if="error" class="mt-2 text-xs text-destructive">{{ error }}</p>
      <div v-else-if="!plan" class="mt-4 text-xs text-muted-foreground">Loading commits…</div>
      <template v-else>
        <div class="mt-2 flex flex-wrap gap-1">
          <Button size="xs" variant="secondary" @click="move(-1)">↑</Button>
          <Button size="xs" variant="secondary" @click="move(1)">↓</Button>
          <Button size="xs" variant="ghost" @click="resetActions">Reset</Button>
        </div>
        <div class="mt-2 min-h-0 flex-1 overflow-auto rounded border">
          <table class="w-full text-left text-[12px]">
            <thead class="sticky top-0 bg-muted text-[11px] text-muted-foreground">
              <tr>
                <th class="px-2 py-1">Action</th>
                <th class="px-2 py-1">Hash</th>
                <th class="px-2 py-1">Subject / Message</th>
                <th class="px-2 py-1">Author</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(item, idx) in plan.items"
                :key="item.sha"
                class="border-t hover:bg-accent/40"
                :class="selected === idx ? 'bg-accent/60' : ''"
                @click="selected = idx"
              >
                <td class="px-2 py-1">
                  <Select v-model="item.action">
                    <SelectTrigger class="h-7 w-auto min-w-[5.5rem] text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="a in actions" :key="a" :value="a">{{ a }}</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td class="px-2 py-1 font-mono text-[11px]">{{ item.sha.slice(0, 7) }}</td>
                <td class="px-2 py-1">
                  <input
                    v-if="item.action === 'reword' || item.action === 'squash'"
                    v-model="item.message"
                    class="h-7 w-full rounded border bg-background px-1"
                    :placeholder="item.subject"
                  />
                  <span v-else>{{ item.subject }}</span>
                </td>
                <td class="px-2 py-1 text-muted-foreground">{{ item.author }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(false)">Cancel</Button>
        <Button size="sm" :disabled="!plan || rewrite.busy" @click="start">Start Rebasing</Button>
      </div>
    </div>
  </div>
</template>
