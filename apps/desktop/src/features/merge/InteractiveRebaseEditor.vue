<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useRewriteDialog } from "./useRewriteDialog";
import type { RebasePlan, RebaseTodoAction } from "@/lib/backend";

const props = defineProps<{
  /** First commit to include (Log “from here”). */
  fromSha?: string;
  /** Exclusive upstream base (Rebase dialog --interactive). */
  upstream?: string;
  onto?: string | null;
  root?: boolean;
  rebaseMerges?: boolean;
  autosquash?: boolean;
}>();
const rewrite = useRewriteStore();
const { t } = useI18n();
const { busy, error, current, dismiss, showError, submit } = useRewriteDialog();
const rootMode = props.root;
const seed = rootMode ? "" : (props.upstream ?? props.fromSha);
const upstream = !rootMode && !!props.upstream;
const options = {
  onto: props.onto,
  rebaseMerges: props.rebaseMerges,
  autosquash: props.autosquash,
};
const plan = ref<RebasePlan | null>(null);
const loading = ref(false);
const selected = ref(0);

const actions: RebaseTodoAction[] = ["pick", "reword", "edit", "squash", "fixup", "drop"];

async function load() {
  if (!current() || busy.value || loading.value) return;
  loading.value = true;
  error.value = null;
  try {
    if (seed === undefined || (!seed && !rootMode)) throw new Error("fromSha or upstream required");
    const p = await rewrite.loadInteractivePlan(seed, upstream);
    if (!current()) return;
    if (!p) throw new Error(t("merge.planLoadFailed"));
    plan.value = {
      ...p,
      onto: options.onto ?? p.onto,
      rebaseMerges: options.rebaseMerges ?? p.rebaseMerges,
      autosquash: options.autosquash ?? p.autosquash,
      items: p.items.map((it) => ({ ...it, message: it.message ?? "" })),
    };
  } catch (e: unknown) {
    showError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function move(delta: number) {
  if (!plan.value || busy.value || plan.value.rebaseMerges || plan.value.autosquash) return;
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
  if (!plan.value || busy.value) return;
  plan.value = {
    ...plan.value,
    items: plan.value.items.map((it) => ({ ...it, action: "pick" as const, message: "" })),
  };
}

async function start() {
  if (!plan.value?.items.length || busy.value || !current()) return;
  const toSend: RebasePlan = {
    ...plan.value,
    items: plan.value.items.map((it) => ({
      ...it,
      message: it.message && String(it.message).trim() ? it.message : null,
    })),
  };
  await submit(() => rewrite.startInteractive(toSend));
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    :aria-label="t('merge.interactiveRebase')"
    :aria-busy="loading || busy"
    @keydown.esc.stop.prevent="dismiss"
  >
    <div
      class="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg border bg-popover p-4 shadow-lg"
    >
      <h2 class="text-sm font-semibold">{{ t("merge.interactiveRebase") }}</h2>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t("merge.rebasePlanHint") }}
      </p>
      <p v-if="error" role="alert" class="mt-2 text-xs text-destructive">{{ error }}</p>
      <Button v-if="error && !plan" size="sm" variant="outline" :disabled="loading" @click="load">{{
        t("empty.retry")
      }}</Button>
      <div v-if="!plan && !error" class="mt-4 text-xs text-muted-foreground">
        {{ t("merge.loadingCommits") }}
      </div>
      <template v-if="plan">
        <p v-if="plan.rebaseMerges || plan.autosquash" class="mt-2 text-xs text-muted-foreground">
          {{ t("merge.generatedOrderHint") }}
        </p>
        <div class="mt-2 flex flex-wrap gap-1">
          <Button
            size="xs"
            variant="secondary"
            :disabled="busy || plan.rebaseMerges || plan.autosquash || selected === 0"
            :aria-label="t('merge.moveCommitUp')"
            @click="move(-1)"
            >↑</Button
          >
          <Button
            size="xs"
            variant="secondary"
            :disabled="
              busy || plan.rebaseMerges || plan.autosquash || selected >= plan.items.length - 1
            "
            :aria-label="t('merge.moveCommitDown')"
            @click="move(1)"
            >↓</Button
          >
          <Button size="xs" variant="ghost" :disabled="busy" @click="resetActions">{{
            t("merge.resetActions")
          }}</Button>
        </div>
        <div class="mt-2 min-h-0 flex-1 overflow-auto rounded border">
          <table class="w-full text-left text-[12px]">
            <thead class="sticky top-0 bg-muted text-[11px] text-muted-foreground">
              <tr>
                <th class="px-2 py-1">{{ t("merge.todoAction") }}</th>
                <th class="px-2 py-1">{{ t("merge.commitHash") }}</th>
                <th class="px-2 py-1">{{ t("merge.commitMessage") }}</th>
                <th class="px-2 py-1">{{ t("merge.commitAuthor") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="(item, idx) in plan.items"
                :key="item.sha"
                class="border-t hover:bg-accent/40"
                :class="selected === idx ? 'bg-accent/60' : ''"
                @click="!busy && (selected = idx)"
                @focusin="!busy && (selected = idx)"
              >
                <td class="px-2 py-1">
                  <Select v-model="item.action" :disabled="busy">
                    <SelectTrigger
                      class="h-7 w-auto min-w-[5.5rem] text-[11px]"
                      :aria-label="t('merge.actionForCommit', { sha: item.sha.slice(0, 7) })"
                    >
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
                    :disabled="busy"
                    :aria-label="t('merge.messageForCommit', { sha: item.sha.slice(0, 7) })"
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
        <Button variant="ghost" size="sm" :disabled="busy" @click="dismiss">{{
          t("common.cancel")
        }}</Button>
        <Button size="sm" :disabled="!plan?.items.length || busy" @click="start">{{
          t("merge.startRebasing")
        }}</Button>
      </div>
    </div>
  </div>
</template>
