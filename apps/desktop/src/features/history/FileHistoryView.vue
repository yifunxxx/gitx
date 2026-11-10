<script setup lang="ts">
import { formatCommitTime as formatTime } from "@/lib/commitTime";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Pane, Splitpanes } from "splitpanes";
import { useHistoryStore } from "@/stores/historyStore";
import { Button } from "@/components/ui/button";
import CodeMirrorDiff from "@/features/diff/CodeMirrorDiff.vue";
import VirtualList from "@/components/common/VirtualList.vue";
import EmptyState from "@/components/common/EmptyState.vue";

const props = defineProps<{ tabId: string }>();
const history = useHistoryStore();
const { t } = useI18n();

const tab = computed(() => history.tabs.find((t) => t.id === props.tabId));
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div
      class="flex min-h-8 shrink-0 flex-wrap items-center gap-2 border-b bg-dbx-chrome px-2 py-1 text-xs"
    >
      <span class="max-w-64 truncate font-medium" :title="tab.filePath">{{ tab.filePath }}</span>
      <div class="flex-1" />
      <label class="flex items-center gap-1 text-[11px]">
        <input
          type="checkbox"
          :checked="tab.allBranches"
          @change="history.toggleAllBranches(tab.id)"
        />
        {{ t("history.allBranches") }}
      </label>
      <Button size="xs" variant="ghost" :disabled="tab.loading" @click="history.load(tab, true)">{{
        t("history.refresh")
      }}</Button>
      <Button
        size="xs"
        variant="outline"
        :disabled="!tab.selectedSha"
        @click="history.compareLocal(tab)"
        >{{ t("history.compareWithLocal") }}</Button
      >
    </div>
    <Splitpanes class="min-h-0 flex-1">
      <Pane :size="40" min-size="24">
        <EmptyState
          v-if="!tab.commits.length"
          :title="
            tab.loading
              ? t('common.loading')
              : tab.error
                ? t('history.loadFailed')
                : t('history.empty')
          "
          :description="tab.error ?? undefined"
        >
          <Button v-if="tab.error" size="xs" @click="history.load(tab, true)">{{
            t("history.retry")
          }}</Button>
        </EmptyState>
        <VirtualList
          v-else
          :key="tab.allBranches ? 'all' : 'branch'"
          class="h-full text-[12px]"
          :items="tab.commits"
          :item-height="52"
          :get-key="(c) => c.sha"
          preserve-scroll-anchor
        >
          <template #default="{ item: c }">
            <button
              type="button"
              class="flex h-full w-full min-w-0 flex-col justify-center gap-0.5 border-b px-2 text-left"
              :class="tab.selectedSha === c.sha ? 'bg-accent' : 'hover:bg-accent/40'"
              :aria-pressed="tab.selectedSha === c.sha"
              @click="history.select(tab, c.sha)"
            >
              <span class="truncate font-medium">{{ c.subject }}</span>
              <span
                class="max-w-full truncate text-[11px] text-muted-foreground"
                :title="`${c.author} · ${formatTime(c.authorTime)} · ${c.pathAtCommit}`"
              >
                {{ c.shortSha }} · {{ c.author }} · {{ formatTime(c.authorTime) }}
                <template v-if="c.pathAtCommit !== tab.filePath"> · {{ c.pathAtCommit }} </template>
              </span>
            </button>
          </template>
          <template #footer>
            <div v-if="tab.error" role="alert" class="p-2 text-xs text-destructive">
              {{ tab.error }}
            </div>
            <button
              v-if="tab.truncated"
              type="button"
              class="w-full py-2 text-xs text-muted-foreground disabled:opacity-50"
              :disabled="tab.loading"
              @click="history.load(tab, false)"
            >
              {{
                tab.loading
                  ? t("common.loading")
                  : tab.error
                    ? t("history.retry")
                    : t("log.loadMore")
              }}
            </button>
          </template>
        </VirtualList>
      </Pane>
      <Pane :size="60">
        <EmptyState v-if="tab.diffLoading" :title="t('common.loading')" />
        <EmptyState
          v-else-if="tab.diffError"
          :title="t('history.diffFailed')"
          :description="tab.diffError"
        >
          <Button size="xs" @click="tab.selectedSha && history.select(tab, tab.selectedSha)">{{
            t("history.retry")
          }}</Button>
        </EmptyState>
        <div v-else-if="tab.diff" class="h-full min-h-0">
          <div v-if="tab.diff.binary" class="p-4 text-xs text-muted-foreground">
            {{ t("history.binaryDiff") }}
          </div>
          <div v-else-if="tab.diff.tooLarge" class="p-4 text-xs text-muted-foreground">
            {{ t("history.tooLarge") }}
          </div>
          <CodeMirrorDiff
            v-else-if="tab.diff.hunks.length"
            side="unified"
            unified
            :text="''"
            :hunks="tab.diff.hunks"
          />
          <div v-else class="p-4 text-xs text-muted-foreground">{{ t("diff.noDifferences") }}</div>
        </div>
        <div v-else class="p-4 text-xs text-muted-foreground">
          {{ t("history.selectRevision") }}
        </div>
      </Pane>
    </Splitpanes>
  </div>
</template>
