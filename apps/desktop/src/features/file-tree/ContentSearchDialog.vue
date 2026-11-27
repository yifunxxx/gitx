<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Search,
  X,
  LoaderCircle,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  FileText,
} from "@lucide/vue";
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
const pageLoading = ref(false);
const stopping = ref(false);
const retryPage = ref<number | null>(null);
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
    !applying.value &&
    !opening.value &&
    !pageLoading.value &&
    !stopping.value,
);
const current = (token: number) =>
  !disposed &&
  token === generation &&
  workspace.folderPath === folder &&
  workspace.navigationToken() === navigation;
function setMode(replace: boolean) {
  if (applying.value || opening.value) return;
  replacingMode.value = replace;
  confirming.value = false;
}
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
  pageLoading.value = false;
  stopping.value = false;
  retryPage.value = null;
}
function close() {
  if (!applying.value) closeDialog(null, dialogId);
}
async function stop() {
  if (!loading.value || stopping.value || opening.value || applying.value) return;
  if (!searchJob) {
    cancel();
    stopped.value = true;
    return;
  }
  clearTimeout(debounce);
  clearTimeout(poll);
  ++pageRequest;
  pageLoading.value = false;
  retryPage.value = null;
  error.value = "";
  stopped.value = true;
  confirming.value = false;
  stopping.value = true;
  const token = generation;
  try {
    const retained = await getBackend().fsStopContentSearch({ sessionId, generation: token });
    if (!current(token)) return;
    if (retained) await readPage(token);
    else {
      result.value = null;
      loading.value = false;
      finishJob();
    }
  } catch (failure) {
    if (current(token)) {
      error.value = formatErrorMessage(failure);
      stopped.value = false;
      poll = setTimeout(() => void readPage(token), 150);
    }
  } finally {
    if (current(token)) stopping.value = false;
  }
}
async function readPage(token: number, target = page.value, resetSelection = false): Promise<void> {
  if (!current(token)) return;
  clearTimeout(poll);
  const request = ++pageRequest;
  try {
    const response = await getBackend().fsContentSearchPage({
      sessionId,
      generation: token,
      page: target,
    });
    if (!current(token) || request !== pageRequest) return;
    const lastPage = Math.max(0, Math.ceil(response.total / 200) - 1);
    if (target > lastPage) {
      await readPage(token, lastPage, true);
      return;
    }
    result.value = response;
    page.value = target;
    loading.value = !response.done;
    pageLoading.value = false;
    error.value = response.error ?? "";
    retryPage.value = null;
    if (resetSelection) selected.value = 0;
    else selected.value = Math.max(0, Math.min(selected.value, response.matches.length - 1));
    if (searchJob)
      jobs.progress(searchJob, {
        message: t("contentSearch.summary", {
          count: response.total,
          files: response.files,
          scanned: response.scanned,
        }),
      });
    if (response.done) {
      finishJob();
      if (stopped.value) notice.value = t("contentSearch.stopped");
    }
    if (!response.done) poll = setTimeout(() => void readPage(token), 150);
    if (resetSelection) {
      const owner = list.value;
      await nextTick();
      if (current(token) && request === pageRequest && list.value === owner)
        owner?.scrollToIndex(0);
    }
  } catch (failure) {
    if (current(token) && request === pageRequest) {
      error.value = formatErrorMessage(failure);
      pageLoading.value = false;
      retryPage.value = target;
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
    if (current(token) && !stopped.value) await readPage(token);
  } catch (failure) {
    if (current(token) && !stopped.value) {
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
async function loadPage(target: number) {
  if (
    pageLoading.value ||
    applying.value ||
    opening.value ||
    stopping.value ||
    !current(generation)
  )
    return;
  clearTimeout(poll);
  pageLoading.value = true;
  error.value = "";
  await readPage(generation, target, true);
}
async function changePage(delta: number) {
  const target = Math.max(0, Math.min(pageCount.value - 1, page.value + delta));
  if (target !== page.value) await loadPage(target);
}
function toggleFile(path: string) {
  const next = new Set(excluded.value);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  excluded.value = next;
  confirming.value = false;
}
async function open(match: ContentMatch) {
  if (opening.value || applying.value || pageLoading.value || !folder || !current(generation))
    return;
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
  <div class="content-search-overlay" @keydown="keydown">
    <section
      role="dialog"
      aria-modal="true"
      :aria-label="t(replacingMode ? 'contentSearch.replaceTitle' : 'fileSearch.contentTitle')"
      class="content-search-dialog"
    >
      <header class="search-header">
        <div class="search-heading">
          <Search class="search-title-icon" aria-hidden="true" />
          <div class="search-heading-text">
            <h2>
              {{ t(replacingMode ? "contentSearch.replaceTitle" : "fileSearch.contentTitle") }}
            </h2>
            <p class="search-workspace" :title="folder ?? ''">{{ folder }}</p>
          </div>
        </div>
        <button
          type="button"
          :disabled="applying"
          :aria-label="t('common.close')"
          class="search-icon-button"
          @click="close"
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
      </header>
      <div class="content-search-body">
        <fieldset :disabled="applying || opening" class="search-form">
          <div class="search-modes" role="group" :aria-label="t('contentSearch.mode')">
            <button type="button" :aria-pressed="!replacingMode" @click="setMode(false)">
              {{ t("editor.find") }}
            </button>
            <button type="button" :aria-pressed="replacingMode" @click="setMode(true)">
              {{ t("editor.replace") }}
            </button>
          </div>
          <div class="search-form-row">
            <span class="search-field-label">{{ t("editor.find") }}</span>
            <span class="search-query-field">
              <input
                v-model="query"
                autofocus
                data-search-query
                type="search"
                :aria-label="t('fileSearch.contentPlaceholder')"
                :placeholder="t('fileSearch.contentPlaceholder')"
                spellcheck="false"
                autocomplete="off"
              />
              <span class="search-options">
                <label
                  v-for="option in ['caseSensitive', 'regex', 'wholeWord'] as const"
                  :key="option"
                  class="search-option"
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
                  <span :class="{ 'search-option-word': option === 'wholeWord' }">{{
                    option === "caseSensitive" ? "Aa" : option === "wholeWord" ? "W" : ".*"
                  }}</span>
                </label>
              </span>
            </span>
          </div>
          <label v-if="replacingMode" class="search-form-row">
            <span class="search-field-label">{{ t("editor.replace") }}</span>
            <input
              v-model="replacement"
              :aria-label="t('contentSearch.replacement')"
              :placeholder="t('contentSearch.replacement')"
              spellcheck="false"
              autocomplete="off"
              class="search-text-input"
            />
          </label>
          <p v-if="regex && replacingMode" class="search-input-hint">
            {{ t("contentSearch.captureHint") }}
          </p>
          <div class="search-scope">
            <label class="search-form-row">
              <span class="search-field-label">{{ t("contentSearch.includeLabel") }}</span>
              <input
                v-model="include"
                :aria-label="t('contentSearch.include')"
                :placeholder="t('contentSearch.includePlaceholder')"
                spellcheck="false"
                class="search-text-input"
              />
            </label>
            <label class="search-form-row">
              <span class="search-field-label">{{ t("contentSearch.excludeLabel") }}</span>
              <input
                v-model="exclude"
                :aria-label="t('contentSearch.exclude')"
                :placeholder="t('contentSearch.excludePlaceholder')"
                spellcheck="false"
                class="search-text-input"
              />
            </label>
          </div>
          <div class="search-scope-options">
            <label
              ><input v-model="showHidden" type="checkbox" />{{ t("contentSearch.hidden") }}</label
            >
            <label
              ><input v-model="showIgnored" type="checkbox" />{{
                t("contentSearch.ignored")
              }}</label
            >
          </div>
        </fieldset>
        <div class="search-results-heading">
          <div role="status" class="search-result-summary">
            <LoaderCircle
              v-if="loading || applying || pageLoading || stopping"
              class="h-3.5 w-3.5 shrink-0 animate-spin"
              aria-hidden="true"
            />
            <span>{{
              result
                ? t("contentSearch.summary", {
                    count: result.total,
                    files: result.files,
                    scanned: result.scanned,
                  })
                : t(loading ? "fileSearch.searching" : "fileSearch.results")
            }}</span>
          </div>
          <button
            v-if="loading"
            type="button"
            class="search-text-button"
            :disabled="stopping || stopped || opening"
            @click="stop"
          >
            {{ t(stopping || stopped ? "contentSearch.stopping" : "common.cancel") }}
          </button>
          <button
            v-else-if="query"
            type="button"
            class="search-text-button"
            :disabled="applying || opening || stopping"
            @click="schedule"
          >
            {{ t("contentSearch.refresh") }}
          </button>
        </div>
        <div v-if="error" role="alert" class="search-message search-error">{{ error }}</div>
        <button
          v-if="retryPage !== null"
          type="button"
          class="search-text-button"
          :disabled="pageLoading || applying || opening || stopping"
          @click="loadPage(retryPage)"
        >
          {{ t("common.retry") }}
        </button>
        <p v-if="notice" role="status" class="search-message search-notice">{{ notice }}</p>
        <div v-if="!matches.length && !loading && !error" class="search-empty">
          <Search class="h-6 w-6" aria-hidden="true" />
          <p>
            {{ t(stopped ? "fileSearch.stopped" : query ? "fileSearch.empty" : "fileSearch.hint") }}
          </p>
        </div>
        <div v-else-if="loading && !matches.length" class="search-empty">
          <LoaderCircle class="h-6 w-6 animate-spin" aria-hidden="true" />
          <p>{{ t("fileSearch.searching") }}</p>
        </div>
        <div
          v-if="matches.length"
          class="search-results"
          role="listbox"
          :aria-busy="pageLoading"
          :aria-label="t('fileSearch.results')"
        >
          <VirtualList
            ref="list"
            :items="matches"
            :item-height="replacingMode ? 84 : 62"
            :get-key="(m) => `${m.path}:${m.line}:${m.column}`"
            :overscan="6"
          >
            <template #default="{ item: match, index }">
              <div
                class="search-result-row"
                :class="{
                  'is-selected': selected === index,
                  'is-excluded': replacingMode && excluded.has(match.path),
                }"
                :style="{ height: replacingMode ? '84px' : '62px' }"
              >
                <input
                  v-if="replacingMode"
                  type="checkbox"
                  :aria-label="t('contentSearch.selectFile', { path: match.path })"
                  :checked="!excluded.has(match.path)"
                  :disabled="applying || loading || pageLoading || opening || stopped"
                  @change="toggleFile(match.path)"
                />
                <button
                  role="option"
                  :aria-selected="selected === index"
                  :aria-label="`${match.path}:${match.line}:${match.column}`"
                  :disabled="opening || applying || pageLoading"
                  class="search-result-content"
                  @click="open(match)"
                >
                  <span class="search-result-location">
                    <FileText
                      class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <span class="search-result-path" :title="match.path">{{ match.path }}</span>
                    <span class="search-result-position">{{ match.line }}:{{ match.column }}</span>
                  </span>
                  <span class="search-result-preview" :title="match.preview"
                    >{{ match.preview.slice(0, match.matchStart)
                    }}<mark>{{ match.preview.slice(match.matchStart, match.matchEnd) || "│" }}</mark
                    >{{ match.preview.slice(match.matchEnd) }}</span
                  >
                  <span
                    v-if="replacingMode"
                    class="search-replacement-preview"
                    :title="match.replacementPreview"
                    ><ArrowRight class="h-3 w-3 shrink-0" aria-hidden="true" /><span>{{
                      match.replacementPreview
                    }}</span></span
                  >
                </button>
              </div>
            </template>
          </VirtualList>
        </div>
        <div v-if="result && pageCount > 1" class="search-pagination">
          <button
            type="button"
            :disabled="page === 0 || applying || opening || pageLoading || stopping"
            :aria-label="t('contentSearch.previousPage')"
            class="search-icon-button"
            @click="changePage(-1)"
          >
            <ChevronLeft class="h-4 w-4" aria-hidden="true" />
          </button>
          <span>{{ t("contentSearch.page", { page: page + 1, pages: pageCount }) }}</span>
          <span v-if="pageLoading" role="status">{{ t("common.loading") }}</span>
          <button
            type="button"
            :disabled="page + 1 >= pageCount || applying || opening || pageLoading || stopping"
            :aria-label="t('contentSearch.nextPage')"
            class="search-icon-button"
            @click="changePage(1)"
          >
            <ChevronRight class="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <details v-if="result?.skipped" class="search-skipped">
          <summary>{{ t("fileSearch.skipped", { count: result.skipped }) }}</summary>
          <p v-for="issue in result.issues" :key="issue">{{ issue }}</p>
        </details>
      </div>
      <footer class="search-footer">
        <div v-if="replacingMode" class="search-selection">
          <strong>{{ t("contentSearch.selectedFiles", { count: selectedFiles }) }}</strong>
          <span>{{ t("contentSearch.selectionScope") }}</span>
        </div>
        <p v-if="replacingMode && busyDrafts" class="search-draft-warning">
          {{ t("contentSearch.saveDrafts") }}
        </p>
        <div v-if="replacingMode && confirming" class="search-confirmation" role="status">
          <strong>{{ t("contentSearch.confirm", { count: selectedFiles }) }}</strong>
          <span>{{ t("contentSearch.writeHint") }}</span>
        </div>
        <div class="search-footer-bottom">
          <p class="search-footer-hint" :title="t('contentSearch.scope')">
            {{ t(replacingMode ? "contentSearch.selectionHelp" : "contentSearch.savedTextHint") }}
          </p>
          <div class="search-footer-actions">
            <button type="button" :disabled="applying" class="search-button" @click="close">
              {{ t("common.cancel") }}
            </button>
            <button
              v-if="replacingMode"
              type="button"
              :disabled="!canReplace"
              class="search-button search-button-primary"
              @click="apply"
            >
              {{
                t(confirming ? "contentSearch.confirmReplace" : "contentSearch.replaceFiles", {
                  count: selectedFiles,
                })
              }}
            </button>
            <button
              v-else
              type="button"
              :disabled="!query || applying || loading"
              class="search-button search-button-primary"
              @click="schedule"
            >
              {{ t(loading ? "fileSearch.searching" : "contentSearch.search") }}
            </button>
          </div>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.content-search-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 6vh 24px 24px;
  background: #0006;
}
.content-search-dialog {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 880px;
  max-height: 88vh;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-popover);
  color: var(--color-foreground);
  box-shadow: 0 18px 56px #0003;
  font-size: 12px;
}
.search-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  flex: none;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--color-border);
}
.search-heading {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.search-title-icon {
  width: 18px;
  height: 18px;
  flex: none;
  margin-top: 2px;
  color: var(--color-muted-foreground);
}
.search-heading-text {
  min-width: 0;
}
.search-heading h2 {
  margin: 0;
  font-size: 15px;
  line-height: 22px;
  font-weight: 600;
}
.search-workspace {
  margin: 3px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-muted-foreground);
  font-size: 11px;
}
.content-search-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
.search-form {
  flex: none;
  min-width: 0;
  margin: 0;
  padding: 14px 20px 16px;
  border: 0;
}
.search-modes {
  display: inline-flex;
  gap: 2px;
  margin: 0 0 12px;
  padding: 3px;
  border-radius: 7px;
  background: var(--color-muted);
}
.search-modes button {
  min-width: 72px;
  height: 27px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: 5px;
  color: var(--color-muted-foreground);
}
.search-modes button[aria-pressed="true"] {
  border-color: var(--color-border);
  background: var(--color-background);
  color: var(--color-foreground);
  box-shadow: 0 1px 2px #00000008;
}
.search-form-row {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.search-form-row + .search-form-row {
  margin-top: 8px;
}
.search-field-label {
  color: var(--color-muted-foreground);
  font-size: 12px;
}
.search-query-field {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 34px;
  border: 1px solid var(--color-input);
  border-radius: 6px;
  background: var(--color-background);
}
.search-query-field:focus-within,
.search-text-input:focus {
  outline: none;
  border-color: color-mix(in srgb, var(--color-ring) 65%, var(--color-border));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-ring) 12%, transparent);
}
.search-query-field > input {
  flex: 1 1 0;
  min-width: 0;
  width: 0;
  height: 100%;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--color-foreground);
  outline: none;
  font-size: 12px;
}
.search-query-field > input::-webkit-search-cancel-button {
  display: none;
}
.search-text-input {
  width: 100%;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--color-input);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-foreground);
  outline: none;
  font-size: 12px;
}
.search-text-input::placeholder,
.search-query-field input::placeholder {
  color: var(--color-muted-foreground);
  opacity: 0.8;
}
.search-options {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
}
.search-option {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 4px;
  color: var(--color-muted-foreground);
  font-size: 11px;
  cursor: pointer;
  user-select: none;
}
.search-option input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.search-option:has(:checked) {
  background: var(--color-selection);
  color: var(--color-selection-foreground);
  border-color: color-mix(in srgb, var(--color-ring) 35%, transparent);
}
.search-option:hover {
  background: var(--color-accent);
}
.search-option-word {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.search-input-hint {
  margin: 6px 0 0 74px;
  color: var(--color-muted-foreground);
  font-size: 11px;
}
.search-scope {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 16px;
  margin-top: 16px;
}
.search-scope .search-form-row + .search-form-row {
  margin-top: 0;
}
.search-scope .search-text-input {
  height: 30px;
}
.search-scope-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 20px;
  margin: 10px 0 0 74px;
  color: var(--color-muted-foreground);
  font-size: 11px;
}
.search-scope-options label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.search-results-heading {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 20px;
  border-block: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-muted) 35%, transparent);
}
.search-result-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  color: var(--color-muted-foreground);
  font-size: 11px;
}
.search-text-button {
  flex: none;
  font-size: 11px;
  color: var(--color-foreground);
  padding: 3px 5px;
  border-radius: 4px;
}
.search-text-button:hover {
  background: var(--color-accent);
}
.search-empty {
  display: flex;
  flex: 1 0 160px;
  min-height: 160px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  color: var(--color-muted-foreground);
}
.search-results {
  display: flex;
  flex: 1 1 360px;
  flex-direction: column;
  height: min(38vh, 360px);
  min-height: 160px;
  overflow: hidden;
  background: var(--color-background);
}
.search-result-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 20px;
  border-bottom: 1px solid color-mix(in srgb, var(--color-border) 55%, transparent);
}
.search-result-row.is-selected {
  background: color-mix(in srgb, var(--color-accent) 70%, transparent);
}
.search-result-row:hover {
  background: var(--color-accent);
}
.search-result-row > input {
  flex: none;
}
.search-result-content {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
  text-align: left;
}
.search-result-row.is-excluded .search-result-content {
  opacity: 0.55;
}
.search-result-location {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  line-height: 16px;
}
.search-result-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
}
.search-result-position {
  flex: none;
  margin-left: auto;
  color: var(--color-muted-foreground);
  font-family: var(--font-mono);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}
.search-result-preview {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono);
  color: var(--color-muted-foreground);
  font-size: 11px;
  line-height: 16px;
}
.search-result-preview mark {
  border-radius: 2px;
  background: #eab30830;
  color: var(--color-foreground);
}
.search-replacement-preview {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  min-width: 0;
  color: var(--color-success);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 16px;
}
.search-replacement-preview > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-pagination {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 7px 20px;
  border-top: 1px solid var(--color-border);
  color: var(--color-muted-foreground);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.search-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 5px;
  color: var(--color-muted-foreground);
}
.search-icon-button:hover:not(:disabled) {
  background: var(--color-accent);
  color: var(--color-foreground);
}
.search-message {
  flex: none;
  padding: 10px 20px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.search-error {
  color: var(--color-destructive);
}
.search-notice {
  color: var(--color-success);
}
.search-skipped {
  flex: none;
  padding: 8px 20px;
  color: var(--color-muted-foreground);
  font-size: 11px;
}
.search-skipped summary {
  cursor: pointer;
}
.search-skipped p {
  margin-top: 5px;
  overflow-wrap: anywhere;
}
.search-footer {
  flex: none;
  padding: 12px 20px;
  border-top: 1px solid var(--color-border);
  background: color-mix(in srgb, var(--color-muted) 25%, var(--color-popover));
}
.search-selection {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 5px 9px;
  margin-bottom: 8px;
}
.search-selection strong {
  font-size: 12px;
  font-weight: 600;
}
.search-selection > span {
  color: var(--color-muted-foreground);
  font-size: 11px;
}
.search-draft-warning {
  margin-bottom: 10px;
  color: var(--color-warning);
  font-size: 11px;
}
.search-confirmation {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 9px 11px;
  margin-bottom: 10px;
  border-left: 3px solid var(--color-warning);
  background: color-mix(in srgb, var(--color-warning) 7%, transparent);
  border-radius: 3px;
  font-size: 12px;
}
.search-confirmation span {
  color: var(--color-muted-foreground);
  font-size: 11px;
}
.search-footer-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.search-footer-hint {
  min-width: 0;
  color: var(--color-muted-foreground);
  font-size: 11px;
  line-height: 17px;
}
.search-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.search-button {
  min-height: 32px;
  padding: 6px 12px;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-foreground);
  font-size: 12px;
}
.search-button:hover:not(:disabled) {
  background: var(--color-accent);
}
.search-button-primary {
  background: var(--color-primary);
  color: var(--color-primary-foreground);
  border-color: var(--color-primary);
}
.search-button-primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary) 88%, var(--color-background));
}
.content-search-dialog button:disabled,
.content-search-dialog fieldset:disabled {
  opacity: 0.5;
}
.content-search-dialog button:focus-visible,
.search-option:has(input:focus-visible),
.content-search-dialog input[type="checkbox"]:focus-visible {
  outline: 2px solid var(--color-ring);
  outline-offset: 2px;
}
.content-search-dialog input[type="checkbox"] {
  accent-color: var(--color-primary);
}
@media (max-width: 640px) {
  .content-search-overlay {
    padding: 12px;
  }
  .content-search-dialog {
    max-height: calc(100dvh - 24px);
    border-radius: 8px;
  }
  .search-header {
    padding: 14px;
  }
  .search-form {
    padding: 12px 14px;
  }
  .search-form-row {
    grid-template-columns: 48px minmax(0, 1fr);
    gap: 8px;
  }
  .search-scope {
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    margin-top: 12px;
  }
  .search-input-hint,
  .search-scope-options {
    margin-left: 56px;
  }
  .search-results-heading,
  .search-result-row,
  .search-message {
    padding-left: 14px;
    padding-right: 14px;
  }
  .search-footer {
    padding: 12px 14px;
  }
  .search-footer-bottom {
    align-items: stretch;
    flex-direction: column;
    gap: 10px;
  }
  .search-footer-actions {
    justify-content: flex-end;
    flex-wrap: wrap;
  }
  .search-results {
    height: 32vh;
  }
  .search-result-summary {
    overflow-wrap: anywhere;
  }
}
@media (max-height: 620px) {
  .content-search-overlay {
    padding-top: 12px;
  }
  .content-search-dialog {
    max-height: calc(100dvh - 24px);
  }
}
</style>
