<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Pane, Splitpanes } from "splitpanes";
import { useRepoAtRevStore } from "@/stores/repoAtRevStore";
import { Button } from "@/components/ui/button";
import VirtualList from "@/components/common/VirtualList.vue";
import TextViewport from "@/components/common/TextViewport.vue";
import FileTypeIcon from "@/components/files/FileTypeIcon.vue";
import EmptyState from "@/components/common/EmptyState.vue";

const props = defineProps<{ tabId: string }>();
const store = useRepoAtRevStore();
const { t } = useI18n();

const tab = computed(() => store.tabs.find((t) => t.id === props.tabId));
</script>

<template>
  <div v-if="tab" class="flex h-full min-h-0 flex-col">
    <div
      class="flex min-h-8 shrink-0 flex-wrap items-center gap-2 border-b bg-dbx-chrome px-2 py-1 text-xs"
    >
      <span class="max-w-48 truncate font-medium" :title="tab.rev">{{ tab.rev.slice(0, 12) }}</span>
      <span class="max-w-48 truncate font-mono text-muted-foreground" :title="tab.dir || '/'">{{
        tab.dir || "/"
      }}</span>
      <div class="flex-1" />
      <Button size="xs" variant="ghost" :disabled="!tab.dir" @click="store.goUp(tab)">{{
        t("history.up")
      }}</Button>
      <Button
        size="xs"
        variant="ghost"
        :disabled="tab.loading"
        @click="store.loadDir(tab, tab.dir)"
        >{{ t("history.refresh") }}</Button
      >
      <Button
        size="xs"
        variant="ghost"
        :disabled="!tab.selectedPath"
        @click="store.showHistory(tab)"
      >
        {{ t("history.showHistory") }}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        :disabled="!tab.selectedPath"
        @click="store.compareLocal(tab)"
      >
        {{ t("history.compareWithLocal") }}
      </Button>
      <Button
        size="xs"
        variant="outline"
        :disabled="!tab.selectedPath || store.busy"
        @click="store.restoreFile(tab)"
      >
        {{ store.busy ? t("common.loading") : t("history.restore") }}
      </Button>
    </div>
    <div v-if="tab.restoreError" role="alert" class="shrink-0 p-2 text-xs text-destructive">
      {{ tab.restoreError }}
    </div>
    <Splitpanes class="min-h-0 flex-1">
      <Pane :size="36" min-size="20">
        <EmptyState
          v-if="tab.loading || tab.error || !tab.entries.length"
          :title="
            tab.loading
              ? t('common.loading')
              : tab.error
                ? t('history.directoryFailed')
                : t('history.emptyDirectory')
          "
          :description="tab.error ?? undefined"
        >
          <Button v-if="tab.error" size="xs" @click="store.loadDir(tab, tab.dir)">{{
            t("history.retry")
          }}</Button>
        </EmptyState>
        <VirtualList
          v-else
          :key="tab.dir"
          class="h-full text-[12px]"
          :items="tab.entries"
          :item-height="24"
          :get-key="(e) => e.path"
        >
          <template #default="{ item: e }">
            <button
              type="button"
              class="flex h-full w-full items-center gap-1 px-2 text-left hover:bg-accent/50 disabled:opacity-50"
              :class="tab.selectedPath === e.path ? 'bg-accent' : ''"
              :aria-pressed="tab.selectedPath === e.path"
              :disabled="e.kind !== 'tree' && e.kind !== 'blob'"
              :title="
                e.kind !== 'tree' && e.kind !== 'blob' ? t('history.unsupportedEntry') : e.path
              "
              @click="store.openEntry(tab, e)"
            >
              <FileTypeIcon :name="e.name" :kind="e.kind === 'tree' ? 'folder' : 'file'" />
              <span class="truncate">{{ e.name }}</span>
            </button>
          </template>
        </VirtualList>
      </Pane>
      <Pane :size="64">
        <EmptyState v-if="tab.blobLoading" :title="t('common.loading')" />
        <EmptyState
          v-else-if="tab.blobError"
          :title="t('history.fileFailed')"
          :description="tab.blobError"
        >
          <Button size="xs" @click="store.retryBlob(tab)">{{ t("history.retry") }}</Button>
        </EmptyState>
        <TextViewport
          v-else-if="typeof tab.blob?.text === 'string'"
          :key="`${tab.id}:${tab.rev}:${tab.selectedPath}`"
          :text="tab.blob.text"
          :label="tab.selectedPath || tab.title"
          class="h-full"
        />
        <div v-else-if="tab.blob?.binary" class="p-4 text-xs">
          {{ t("history.binaryFile", { size: tab.blob.size }) }}
        </div>
        <div v-else-if="tab.blob?.tooLarge" class="p-4 text-xs">{{ t("history.tooLarge") }}</div>
        <div v-else class="p-4 text-xs text-muted-foreground">{{ t("history.selectFile") }}</div>
      </Pane>
    </Splitpanes>
  </div>
</template>
