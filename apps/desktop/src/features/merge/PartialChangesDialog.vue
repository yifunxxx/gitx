<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import VirtualList from "@/components/common/VirtualList.vue";
import type { ChangedFile } from "@/lib/backend";
import { getBackend } from "@/lib/backend";
import { useRewriteStore } from "@/stores/rewriteStore";
import { useRewriteDialog } from "./useRewriteDialog";

const props = defineProps<{ commit: string; mode: "extract" | "drop"; initialPaths?: string[] }>();
const commit = props.commit;
const mode = props.mode;
const initialPaths = new Set(props.initialPaths ?? []);
const { t } = useI18n();
const rewrite = useRewriteStore();
const { path, busy, error, current, dismiss, showError, submit } = useRewriteDialog();
const files = ref<ChangedFile[]>([]);
const selected = ref(new Set<string>());
const subject = ref("");
const message = ref(t("log.extractedDefault"));
const query = ref("");
const loading = ref(false);
const loaded = ref(false);
const list = ref<{ el: HTMLElement | null; scrollToIndex: (index: number) => void } | null>(null);
const title = computed(() =>
  t(mode === "extract" ? "actions.extractSelected" : "actions.dropSelected"),
);
const filtered = computed(() => {
  const term = query.value.toLocaleLowerCase();
  return files.value.filter((file) =>
    `${file.path}\n${file.origPath ?? ""}`.toLocaleLowerCase().includes(term),
  );
});

async function load() {
  if (!path || !current() || busy.value || loading.value) return;
  loading.value = true;
  error.value = null;
  try {
    const [details, changed] = await Promise.all([
      getBackend().logCommitDetails({ path, sha: commit }),
      getBackend().logChangedFiles({ path, sha: commit }),
    ]);
    if (!current()) return;
    subject.value = details.subject;
    files.value = changed;
    selected.value = new Set(
      changed.filter((file) => initialPaths.has(file.path)).map((file) => file.path),
    );
    loaded.value = true;
  } catch (reason) {
    showError(reason);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function toggle(path: string) {
  if (busy.value) return;
  if (selected.value.has(path)) selected.value.delete(path);
  else selected.value.add(path);
}
async function moveFocus(event: KeyboardEvent, index: number) {
  const key = event.key;
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) return;
  event.preventDefault();
  const next =
    key === "Home"
      ? 0
      : key === "End"
        ? filtered.value.length - 1
        : index + (key === "ArrowDown" ? 1 : -1);
  const target = Math.max(0, Math.min(filtered.value.length - 1, next));
  list.value?.scrollToIndex(target);
  await nextTick();
  list.value?.el?.querySelector<HTMLInputElement>(`[data-file-index="${target}"]`)?.focus();
}
async function ok() {
  if (
    loading.value ||
    !loaded.value ||
    !selected.value.size ||
    (mode === "extract" && !message.value.trim())
  )
    return;
  const paths = files.value
    .filter((file) => selected.value.has(file.path))
    .map((file) => file.path);
  await submit(() =>
    mode === "extract"
      ? rewrite.extractChanges(commit, paths, message.value)
      : rewrite.dropChanges(commit, paths),
  );
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4"
    role="dialog"
    aria-modal="true"
    :aria-label="title"
    :aria-busy="loading || busy"
    @keydown.esc.stop.prevent="dismiss"
  >
    <div
      class="flex max-h-[90vh] w-full max-w-2xl flex-col gap-3 overflow-auto rounded-lg border bg-popover p-4 shadow-lg"
    >
      <div>
        <h2 class="text-sm font-semibold">{{ title }}</h2>
        <p class="mt-1 break-words text-xs text-muted-foreground">
          <span class="font-mono">{{ commit.slice(0, 12) }}</span> · {{ subject }}
        </p>
        <p class="mt-2 text-xs text-muted-foreground">
          {{ t(mode === "extract" ? "rewrite.extractHint" : "rewrite.dropChangesHint") }}
        </p>
      </div>
      <p v-if="loading" class="text-xs text-muted-foreground">{{ t("common.loading") }}</p>
      <p v-if="error" role="alert" class="text-xs text-destructive">{{ error }}</p>
      <Button
        v-if="error && !loaded"
        size="sm"
        variant="outline"
        :disabled="loading"
        @click="load"
        >{{ t("empty.retry") }}</Button
      >
      <input
        v-model="query"
        type="search"
        autofocus
        :aria-label="t('rewrite.filterFiles')"
        :placeholder="t('rewrite.filterFiles')"
        :disabled="!loaded || busy"
        class="h-8 w-full rounded-md border bg-background px-2 text-xs"
      />
      <div class="flex flex-wrap items-center gap-2 text-xs">
        <Button
          size="sm"
          variant="outline"
          :disabled="!loaded || busy || !filtered.length"
          @click="filtered.forEach((file) => selected.add(file.path))"
          >{{ t("rewrite.selectVisible") }}</Button
        >
        <Button
          size="sm"
          variant="ghost"
          :disabled="busy || !selected.size"
          @click="selected.clear()"
          >{{ t("rewrite.clearSelection") }}</Button
        >
        <span role="status" class="ml-auto text-muted-foreground">{{
          t("rewrite.selectedFiles", { selected: selected.size, total: files.length })
        }}</span>
      </div>
      <div class="flex h-[min(30vh,280px)] min-h-[96px] shrink-0 flex-col rounded-md border">
        <VirtualList
          ref="list"
          :items="filtered"
          :item-height="36"
          :get-key="(file: ChangedFile) => file.path"
        >
          <template #default="{ item: file, index }">
            <label
              class="flex h-full cursor-pointer items-center gap-2 px-2 text-xs hover:bg-accent focus-within:bg-accent"
              :title="file.origPath ? `${file.origPath} → ${file.path}` : file.path"
            >
              <input
                type="checkbox"
                :checked="selected.has(file.path)"
                :disabled="busy"
                :aria-label="file.origPath ? `${file.origPath} → ${file.path}` : file.path"
                :data-file-index="index"
                @change="toggle(file.path)"
                @keydown="moveFocus($event, index)"
              />
              <span class="w-6 shrink-0 font-mono text-muted-foreground">{{ file.status }}</span>
              <span class="truncate font-mono"
                ><template v-if="file.origPath">{{ file.origPath }} → </template
                >{{ file.path }}</span
              >
            </label>
          </template>
          <template #footer
            ><p v-if="loaded && !filtered.length" class="p-3 text-xs text-muted-foreground">
              {{ t("rewrite.noMatchingFiles") }}
            </p></template
          >
        </VirtualList>
      </div>
      <label v-if="mode === 'extract'" class="text-xs">
        {{ t("merge.commitMessage") }}
        <textarea
          v-model="message"
          :aria-label="t('merge.commitMessage')"
          :disabled="!loaded || busy"
          class="mt-1 min-h-[72px] w-full rounded-md border bg-background p-2 font-mono text-xs"
          spellcheck="false"
        />
      </label>
      <div class="flex justify-end gap-2">
        <Button size="sm" variant="ghost" :disabled="busy" @click="dismiss">{{
          t("common.cancel")
        }}</Button>
        <Button
          size="sm"
          :variant="mode === 'drop' ? 'destructive' : 'default'"
          :disabled="
            loading || !loaded || busy || !selected.size || (mode === 'extract' && !message.trim())
          "
          @click="ok"
          >{{ title }}</Button
        >
      </div>
    </div>
  </div>
</template>
