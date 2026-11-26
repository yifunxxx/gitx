<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Search, X, LoaderCircle, ChevronLeft, ChevronRight } from "@lucide/vue";
import VirtualList from "@/components/common/VirtualList.vue";
import { getBackend, type ContentSearchPage, type ContentMatch } from "@/lib/backend";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import { useChangesStore } from "@/stores/changesStore";
import { useConflictsStore } from "@/stores/conflictsStore";
import { useJobsStore } from "@/stores/jobsStore";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { formatErrorMessage } from "@/lib/errors";

const props = defineProps<{ replace?: boolean }>();
const { t } = useI18n();
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const viewer = useFileViewerStore();
const conflicts = useConflictsStore();
const jobs = useJobsStore();
let searchJob: string | undefined;
function finishJob() {
  if (searchJob) jobs.finished(searchJob);
  searchJob = undefined;
}
const folder = workspace.folderPath;
const navigation = workspace.navigationToken();
const dialogId = useDialogState().value?.id;
const query = ref("");
const replacement = ref("");
const replacingMode = ref(!!props.replace);
const caseSensitive = ref(false);
const wholeWord = ref(false);
const regex = ref(false);
const include = ref("");
const exclude = ref("");
const showHidden = ref(!!settings.settings?.showHiddenInFileTree);
const showIgnored = ref(!!settings.settings?.showIgnoredInFileTree);
const loading = ref(false);
const applying = ref(false);
const opening = ref(false);
const stopped = ref(false);
const error = ref("");
const notice = ref("");
const confirming = ref(false);
const result = shallowRef<ContentSearchPage | null>(null);
const page = ref(0);
const selected = ref(0);
const excluded = ref(new Set<string>());
const list = ref<{ scrollToIndex(index: number): void } | null>(null);
const sessionId = crypto.randomUUID();
let generation = 0;
let disposed = false;
let debounce: ReturnType<typeof setTimeout> | undefined;
let poll: ReturnType<typeof setTimeout> | undefined;
let pageRequest = 0;
const matches = computed(() => result.value?.matches ?? []);
const pageCount = computed(() => Math.max(1, Math.ceil((result.value?.total ?? 0) / 200)));
const selectedFiles = computed(() => Math.max(0, (result.value?.files ?? 0) - excluded.value.size));
const busyDrafts = computed(
  () =>
    viewer.fileMutationPending ||
    conflicts.busy ||
    // Even an unchanged merge result is a buffer that could later overwrite
    // replaced worktree content. Finish or close it before a disk-wide write.
    conflicts.mergeTabs.length > 0 ||
    viewer.tabs.some((tab) => tab.dirty || tab.loading || tab.saving || tab.fileOperationPending),
);
const canReplace = computed(
  () =>
    result.value?.done &&
    !result.value.error &&
    !loading.value &&
    !stopped.value &&
    !error.value &&
    selectedFiles.value > 0 &&
    !busyDrafts.value &&
    !applying.value,
);
const current = (token: number) =>
  !disposed &&
  token === generation &&
  workspace.folderPath === folder &&
  workspace.navigationToken() === navigation;
function cancel() {
  finishJob();
  clearTimeout(debounce);
  clearTimeout(poll);
  ++pageRequest;
  void getBackend()
    .fsCancelSearch({ sessionId, generation })
    .catch(() => {});
  ++generation;
  loading.value = false;
}
function close() {
  if (!applying.value) closeDialog(null, dialogId);
}
function stop() {
  cancel();
  stopped.value = true;
  confirming.value = false;
}
async function readPage(token: number) {
  const request = ++pageRequest;
  try {
    const response = await getBackend().fsContentSearchPage({
      sessionId,
      generation: token,
      page: page.value,
    });
    if (!current(token) || request !== pageRequest) return;
    result.value = response;
    loading.value = !response.done;
    error.value = response.error ?? "";
    if (page.value >= Math.max(1, Math.ceil(response.total / 200))) {
      page.value = Math.max(0, Math.ceil(response.total / 200) - 1);
      await readPage(token);
      return;
    }
    if (searchJob)
      jobs.progress(searchJob, {
        message: t("contentSearch.summary", {
          count: response.total,
          files: response.files,
          scanned: response.scanned,
        }),
      });
    if (response.done) finishJob();
    if (!response.done) poll = setTimeout(() => void readPage(token), 150);
  } catch (failure) {
    if (current(token) && request === pageRequest) {
      error.value = formatErrorMessage(failure);
      loading.value = false;
      finishJob();
    }
  }
}
async function start(token: number) {
  if (!folder || !current(token)) return;
  searchJob = jobs.begin(t("fileSearch.contentTitle"), folder);
  try {
    await getBackend().fsStartContentSearch({
      folderPath: folder,
      query: query.value,
      replacement: replacement.value,
      caseSensitive: caseSensitive.value,
      wholeWord: wholeWord.value,
      regex: regex.value,
      include: include.value,
      exclude: exclude.value,
      showHidden: showHidden.value,
      showIgnored: showIgnored.value,
      sessionId,
      generation: token,
    });
    if (current(token)) await readPage(token);
  } catch (failure) {
    if (current(token)) {
      error.value = formatErrorMessage(failure);
      loading.value = false;
      finishJob();
    }
  }
}
function schedule() {
  cancel();
  result.value = null;
  error.value = "";
  notice.value = "";
  stopped.value = false;
  confirming.value = false;
  excluded.value = new Set();
  page.value = 0;
  selected.value = 0;
  if (!query.value || !folder || applying.value) return;
  loading.value = true;
  const token = generation;
  debounce = setTimeout(() => void start(token), 220);
}
watch(
  [query, replacement, caseSensitive, wholeWord, regex, include, exclude, showHidden, showIgnored],
  schedule,
);
watch(
  () => [workspace.folderPath, workspace.navigationToken()],
  () => {
    if (!current(generation)) {
      cancel();
      close();
    }
  },
);
async function changePage(delta: number) {
  page.value = Math.max(0, Math.min(pageCount.value - 1, page.value + delta));
  selected.value = 0;
  clearTimeout(poll);
  await readPage(generation);
  list.value?.scrollToIndex(0);
}
function toggleFile(path: string) {
  const next = new Set(excluded.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  excluded.value = next;
  confirming.value = false;
}
async function open(match: ContentMatch) {
  if (opening.value || applying.value || !folder || !current(generation)) return;
  opening.value = true;
  const token = generation;
  try {
    await viewer.open(match.path, { folderPath: folder, line: match.line, column: match.column });
    if (!current(token)) return;
    const tab = viewer.tabs.find((tab) => tab.id === viewer.activeId);
    close();
    await nextTick();
    await nextTick();
    if (
      tab &&
      viewer.tabs.includes(tab) &&
      viewer.activeId === tab.id &&
      workspace.folderPath === folder &&
      workspace.navigationToken() === navigation &&
      !useDialogState().value
    )
      tab.reveal = { line: match.line, column: match.column };
  } finally {
    opening.value = false;
  }
}
async function apply() {
  if (!canReplace.value || !folder || !current(generation)) return;
  if (!confirming.value) {
    confirming.value = true;
    return;
  }
  applying.value = true;
  viewer.fileMutationPending = true;
  const token = generation;
  const replaceJob = jobs.begin(t("contentSearch.replaceTitle"), folder);
  try {
    const response = await getBackend().fsReplaceContent({
      sessionId,
      generation: token,
      excludedPaths: [...excluded.value],
    });
    // Invalidate only clean buffers of files that were actually written. Any
    // draft entered through another surface survives and is never overwritten.
    for (const tab of viewer.affectedByFiles(folder, response.completed)) {
      if (!tab.dirty && !tab.saving) viewer.closeTab(tab.id);
    }
    if (workspace.isRepo && current(token)) void useChangesStore().refresh();
    if (current(token)) {
      notice.value = t("contentSearch.replaced", { count: response.completed.length });
      error.value = response.failed.join("\n");
      stopped.value = true;
      confirming.value = false;
    }
  } catch (failure) {
    if (current(token)) {
      error.value = formatErrorMessage(failure);
      confirming.value = false;
    }
  } finally {
    viewer.fileMutationPending = false;
    applying.value = false;
    jobs.finished(replaceJob);
  }
}
function keydown(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  )
    return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    close();
  }
  if ((event.target as HTMLElement)?.dataset.searchQuery === undefined) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    selected.value = Math.max(
      0,
      Math.min(matches.value.length - 1, selected.value + (event.key === "ArrowDown" ? 1 : -1)),
    );
    list.value?.scrollToIndex(selected.value);
  } else if (event.key === "Enter" && !event.repeat && matches.value[selected.value]) {
    event.preventDefault();
    void open(matches.value[selected.value]!);
  }
}
onBeforeUnmount(() => {
  disposed = true;
  cancel();
});
</script>

<template>
  <div
    class="fixed inset-0 flex items-start justify-center bg-black/40 p-6 pt-[6vh]"
    @keydown="keydown"
  >
    <section
      role="dialog"
      aria-modal="true"
      :aria-label="t('fileSearch.contentTitle')"
      class="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border bg-popover shadow-lg"
    >
      <header class="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <Search class="h-4 w-4" />
        <h2 class="flex-1 text-sm font-semibold">
          {{ t(replacingMode ? "contentSearch.replaceTitle" : "fileSearch.contentTitle") }}
        </h2>
        <button
          :disabled="applying"
          :aria-label="t('common.close')"
          class="rounded p-1 hover:bg-accent"
          @click="close"
        >
          <X class="h-4 w-4" />
        </button>
      </header>
      <fieldset :disabled="applying || opening" class="shrink-0 space-y-2 p-3">
        <div class="flex items-center gap-2">
          <input
            v-model="query"
            autofocus
            data-search-query
            type="search"
            :aria-label="t('fileSearch.contentPlaceholder')"
            :placeholder="t('fileSearch.contentPlaceholder')"
            class="min-w-0 flex-1 rounded border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <label
            v-for="option in ['caseSensitive', 'wholeWord', 'regex'] as const"
            :key="option"
            class="cursor-pointer rounded border px-2 py-1.5 text-xs hover:bg-accent"
            :title="t(`contentSearch.${option}`)"
          >
            <input
              type="checkbox"
              :aria-label="t(`contentSearch.${option}`)"
              :checked="
                option === 'caseSensitive'
                  ? caseSensitive
                  : option === 'wholeWord'
                    ? wholeWord
                    : regex
              "
              @change="
                option === 'caseSensitive'
                  ? (caseSensitive = !caseSensitive)
                  : option === 'wholeWord'
                    ? (wholeWord = !wholeWord)
                    : (regex = !regex)
              "
            />
            {{ option === "caseSensitive" ? "Aa" : option === "wholeWord" ? "ab" : ".*" }}
          </label>
        </div>
        <label class="flex items-center gap-2 text-xs"
          ><input v-model="replacingMode" type="checkbox" />{{
            t("contentSearch.showReplace")
          }}</label
        >
        <input
          v-if="replacingMode"
          v-model="replacement"
          :aria-label="t('contentSearch.replacement')"
          :placeholder="t('contentSearch.replacement')"
          class="w-full rounded border bg-background px-3 py-2 text-sm"
        />
        <div class="grid grid-cols-2 gap-2">
          <input
            v-model="include"
            :aria-label="t('contentSearch.include')"
            :placeholder="t('contentSearch.include')"
            class="rounded border bg-background px-2 py-1 text-xs"
          />
          <input
            v-model="exclude"
            :aria-label="t('contentSearch.exclude')"
            :placeholder="t('contentSearch.exclude')"
            class="rounded border bg-background px-2 py-1 text-xs"
          />
        </div>
        <div class="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <label
            ><input v-model="showHidden" type="checkbox" /> {{ t("contentSearch.hidden") }}</label
          >
          <label
            ><input v-model="showIgnored" type="checkbox" /> {{ t("contentSearch.ignored") }}</label
          >
          <span class="min-w-0 truncate" :title="folder ?? ''">{{ folder }}</span>
        </div>
      </fieldset>
      <div
        v-if="query || result"
        class="flex shrink-0 items-center gap-2 border-y px-4 py-2 text-xs"
        role="status"
      >
        <LoaderCircle v-if="loading || applying" class="h-3 w-3 animate-spin" />
        <span>{{
          result
            ? t("contentSearch.summary", {
                count: result.total,
                files: result.files,
                scanned: result.scanned,
              })
            : t(loading ? "fileSearch.searching" : "fileSearch.hint")
        }}</span>
        <button v-if="loading" class="ml-auto underline" @click="stop">
          {{ t("common.cancel") }}
        </button>
        <button v-else-if="query" class="ml-auto underline" :disabled="applying" @click="schedule">
          {{ t("contentSearch.refresh") }}
        </button>
      </div>
      <div v-if="error" role="alert" class="whitespace-pre-wrap px-4 py-2 text-xs text-destructive">
        {{ error }}
      </div>
      <p v-if="notice" role="status" class="px-4 py-2 text-xs">{{ notice }}</p>
      <p v-if="!matches.length && !loading && !error" class="p-5 text-xs text-muted-foreground">
        {{ t(stopped ? "fileSearch.stopped" : query ? "fileSearch.empty" : "fileSearch.hint") }}
      </p>
      <div
        v-if="matches.length"
        class="flex h-[min(42vh,420px)] min-h-0 shrink flex-col overflow-hidden"
        role="listbox"
        :aria-label="t('fileSearch.results')"
      >
        <VirtualList
          ref="list"
          :items="matches"
          :item-height="replacingMode ? 74 : 52"
          :get-key="(m) => `${m.path}:${m.line}:${m.column}`"
          :overscan="6"
        >
          <template #default="{ item: match, index }">
            <div
              class="flex items-center gap-2 px-3 hover:bg-accent"
              :class="selected === index ? 'bg-accent/60' : ''"
              :style="{ height: replacingMode ? '74px' : '52px' }"
            >
              <input
                v-if="replacingMode"
                type="checkbox"
                :aria-label="t('contentSearch.selectFile', { path: match.path })"
                :checked="!excluded.has(match.path)"
                :disabled="applying || loading"
                @change="toggleFile(match.path)"
              />
              <button
                role="option"
                :aria-selected="selected === index"
                :disabled="opening || applying"
                class="min-w-0 flex-1 text-left text-xs"
                @click="open(match)"
              >
                <span class="block truncate" :title="match.path"
                  >{{ match.path
                  }}<span class="text-muted-foreground"
                    >:{{ match.line }}:{{ match.column }}</span
                  ></span
                >
                <span class="block truncate font-mono text-muted-foreground"
                  >{{ match.preview.slice(0, match.matchStart)
                  }}<mark class="rounded bg-yellow-400/25 text-foreground">{{
                    match.preview.slice(match.matchStart, match.matchEnd) || "│"
                  }}</mark
                  >{{ match.preview.slice(match.matchEnd) }}</span
                >
                <span
                  v-if="replacingMode"
                  class="block truncate font-mono text-green-600 dark:text-green-400"
                  >→ {{ match.replacementPreview }}</span
                >
              </button>
            </div>
          </template>
        </VirtualList>
      </div>
      <div
        v-if="result && pageCount > 1"
        class="flex shrink-0 items-center justify-center gap-3 border-t p-2 text-xs"
      >
        <button
          :disabled="page === 0 || applying"
          :aria-label="t('contentSearch.previousPage')"
          @click="changePage(-1)"
        >
          <ChevronLeft class="h-4 w-4" />
        </button>
        {{ t("contentSearch.page", { page: page + 1, pages: pageCount }) }}
        <button
          :disabled="page + 1 >= pageCount || applying"
          :aria-label="t('contentSearch.nextPage')"
          @click="changePage(1)"
        >
          <ChevronRight class="h-4 w-4" />
        </button>
      </div>
      <details v-if="result?.skipped" class="px-4 py-2 text-xs text-muted-foreground">
        <summary>{{ t("fileSearch.skipped", { count: result.skipped }) }}</summary>
        <p v-for="issue in result.issues" :key="issue" class="break-all">{{ issue }}</p>
      </details>
      <footer class="shrink-0 space-y-2 border-t px-4 py-3 text-xs text-muted-foreground">
        <p>{{ t("contentSearch.scope") }}</p>
        <p v-if="regex && replacingMode">{{ t("contentSearch.captureHint") }}</p>
        <template v-if="replacingMode">
          <p>{{ t("contentSearch.selectionHint", { count: selectedFiles }) }}</p>
          <p v-if="busyDrafts" class="text-warning">{{ t("contentSearch.saveDrafts") }}</p>
          <div class="flex items-center justify-end gap-3">
            <span v-if="confirming" class="text-foreground">{{
              t("contentSearch.confirm", { count: selectedFiles })
            }}</span>
            <button
              :disabled="!canReplace"
              class="rounded border bg-primary px-3 py-1.5 text-primary-foreground disabled:opacity-40"
              @click="apply"
            >
              {{
                t(confirming ? "contentSearch.confirmReplace" : "contentSearch.replaceFiles", {
                  count: selectedFiles,
                })
              }}
            </button>
          </div>
        </template>
      </footer>
    </section>
  </div>
</template>
