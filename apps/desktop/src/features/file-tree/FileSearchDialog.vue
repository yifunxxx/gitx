<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { LoaderCircle, Search, X } from "@lucide/vue";
import VirtualList from "@/components/common/VirtualList.vue";
import FileTypeIcon from "@/components/files/FileTypeIcon.vue";
import { getBackend, type FsSearchMatch, type FsSearchResult } from "@/lib/backend";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFileViewerStore } from "@/stores/fileViewerStore";
import { closeDialog, useDialogState } from "@/composables/useDialog";
import { formatErrorMessage } from "@/lib/errors";

const props = defineProps<{ content?: boolean }>();
const { t } = useI18n();
const title = computed(() => t(props.content ? "fileSearch.contentTitle" : "fileSearch.title"));
const caseSensitive = ref(false);
const workspace = useWorkspaceStore();
const settings = useSettingsStore();
const viewer = useFileViewerStore();
const dialogId = useDialogState().value?.id;
const query = ref("");
const loading = ref(false);
const opening = ref(false);
const error = ref("");
const stopped = ref(false);
const result = ref<FsSearchResult | null>(null);
const selected = ref(0);
const list = ref<{
  scrollToIndex(index: number): void;
  isIndexVisible(index: number): boolean;
} | null>(null);
const listId = useId();
const sessionId = crypto.randomUUID();
const folder = workspace.folderPath;
const navigation = workspace.navigationToken();
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
const matches = computed(() => result.value?.matches ?? []);
const current = (token: number) =>
  !disposed &&
  generation === token &&
  workspace.folderPath === folder &&
  workspace.navigationToken() === navigation;
function cancelScan() {
  clearTimeout(timer);
  void getBackend()
    .fsCancelSearch({ sessionId, generation })
    .catch(() => {});
  ++generation;
  loading.value = false;
}
function stop() {
  cancelScan();
  stopped.value = true;
}
function close() {
  closeDialog(null, dialogId);
}
async function search(token: number) {
  if (!folder || !query.value.trim() || !current(token)) return;
  try {
    const response = await getBackend().fsSearchFiles({
      folderPath: folder,
      query: query.value,
      showHidden: !!settings.settings?.showHiddenInFileTree,
      showIgnored: !!settings.settings?.showIgnoredInFileTree,
      sessionId,
      generation: token,
      content: !!props.content,
      caseSensitive: caseSensitive.value,
    });
    if (current(token)) result.value = response;
  } catch (failure) {
    if (current(token)) error.value = formatErrorMessage(failure);
  } finally {
    if (current(token)) loading.value = false;
  }
}
function schedule() {
  cancelScan();
  error.value = "";
  result.value = null;
  stopped.value = false;
  selected.value = 0;
  if (!query.value.trim() || !folder) return;
  loading.value = true;
  const token = generation;
  timer = setTimeout(() => {
    void search(token);
  }, 180);
}
watch(
  () => [
    query.value,
    caseSensitive.value,
    settings.settings?.showHiddenInFileTree,
    settings.settings?.showIgnoredInFileTree,
  ],
  schedule,
);
watch(
  () => [workspace.folderPath, workspace.navigationToken()],
  () => {
    if (!current(generation)) close();
  },
);
async function open(match: FsSearchMatch) {
  if (opening.value || !folder || !current(generation)) return;
  opening.value = true;
  const token = generation;
  try {
    await viewer.open(match.path, {
      folderPath: folder,
      ...(match.line ? { line: match.line, column: match.column ?? 1 } : {}),
    });
    if (current(token)) close();
  } finally {
    opening.value = false;
  }
}
function onKeydown(event: KeyboardEvent) {
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
    if (!event.repeat) close();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    selected.value = Math.max(
      0,
      Math.min(matches.value.length - 1, selected.value + (event.key === "ArrowDown" ? 1 : -1)),
    );
    list.value?.scrollToIndex(selected.value);
  } else if (event.key === "Enter" && !event.repeat && event.target instanceof HTMLInputElement) {
    event.preventDefault();
    if (matches.value[selected.value]) void open(matches.value[selected.value]!);
  }
}
onBeforeUnmount(() => {
  disposed = true;
  cancelScan();
});
</script>

<template>
  <div
    class="fixed inset-0 flex items-start justify-center bg-black/40 p-6 pt-[10vh]"
    @keydown="onKeydown"
  >
    <section
      role="dialog"
      aria-modal="true"
      :aria-label="title"
      class="flex w-full max-w-2xl flex-col overflow-hidden rounded-lg border bg-popover shadow-lg"
    >
      <header class="flex items-center gap-2 border-b px-4 py-3">
        <Search class="h-4 w-4" />
        <h2 class="min-w-0 flex-1 text-sm font-semibold">{{ title }}</h2>
        <button
          type="button"
          :aria-label="t('common.close')"
          class="rounded p-1 hover:bg-accent"
          @click="close"
        >
          <X class="h-4 w-4" />
        </button>
      </header>
      <div class="p-3">
        <input
          v-model="query"
          type="search"
          autofocus
          :aria-label="t('fileSearch.query')"
          :placeholder="t(content ? 'fileSearch.contentPlaceholder' : 'fileSearch.placeholder')"
          :disabled="opening"
          :aria-controls="listId"
          :aria-activedescendant="
            matches[selected] && list?.isIndexVisible(selected)
              ? `${listId}-${selected}`
              : undefined
          "
          class="w-full rounded border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <p class="mt-2 truncate text-xs text-muted-foreground" :title="folder ?? ''">
          {{ folder }}
        </p>
        <label v-if="content" class="mt-2 flex items-center gap-2 text-xs"
          ><input v-model="caseSensitive" type="checkbox" :disabled="opening" />{{
            t("fileSearch.caseSensitive")
          }}</label
        >
      </div>
      <div v-if="loading" role="status" class="flex items-center gap-2 px-4 py-3 text-xs">
        <LoaderCircle class="h-4 w-4 animate-spin" />{{ t("fileSearch.searching")
        }}<button type="button" class="ml-auto rounded border px-2 py-1" @click="stop">
          {{ t("common.cancel") }}
        </button>
      </div>
      <div v-else-if="error" role="alert" class="px-4 py-3 text-xs text-destructive">
        {{ error }}
        <button type="button" class="underline" @click="schedule">{{ t("empty.retry") }}</button>
      </div>
      <p v-else-if="!matches.length" class="px-4 py-6 text-xs text-muted-foreground">
        {{
          t(stopped ? "fileSearch.stopped" : query.trim() ? "fileSearch.empty" : "fileSearch.hint")
        }}
      </p>
      <div
        v-if="matches.length"
        :id="listId"
        role="listbox"
        :aria-label="t('fileSearch.results')"
        class="h-[min(45vh,420px)] min-h-0"
      >
        <VirtualList
          ref="list"
          :items="matches"
          :item-height="content ? 52 : 36"
          :get-key="(match) => `${match.path}:${match.line ?? 0}`"
          :overscan="8"
        >
          <template #default="{ item: match, index }">
            <button
              :id="`${listId}-${index}`"
              type="button"
              role="option"
              :aria-selected="selected === index"
              :disabled="opening"
              class="flex w-full items-center gap-2 px-4 text-left text-xs hover:bg-accent"
              :style="{ height: content ? '52px' : '36px' }"
              :class="selected === index ? 'bg-accent' : ''"
              @click="open(match)"
            >
              <FileTypeIcon :name="match.path" kind="file" />
              <span class="min-w-0 flex-1"
                ><span class="block truncate" :title="match.path"
                  >{{ match.path
                  }}<template v-if="match.line"
                    >:{{ match.line }}:{{ match.column }}</template
                  ></span
                ><span v-if="match.preview != null" class="block truncate text-muted-foreground">{{
                  match.preview
                }}</span></span
              >
            </button>
          </template>
        </VirtualList>
      </div>
      <p v-if="result?.truncated" role="status" class="border-t px-4 py-2 text-xs text-warning">
        {{ t("fileSearch.limited") }}
      </p>
      <p v-if="result?.skipped" role="status" class="px-4 py-2 text-xs text-muted-foreground">
        {{ t("fileSearch.skipped", { count: result.skipped }) }}
      </p>
      <footer class="border-t px-4 py-2 text-xs text-muted-foreground">
        {{ t("fileSearch.visibility") }}
        <span v-if="content"> {{ t("fileSearch.contentScope") }}</span>
      </footer>
    </section>
  </div>
</template>
