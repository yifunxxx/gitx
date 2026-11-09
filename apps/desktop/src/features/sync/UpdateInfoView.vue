<script setup lang="ts">
import { useSyncStore } from "@/stores/syncStore";
import PathTreeList from "@/components/files/PathTreeList.vue";
import type { ChangedFile } from "@/lib/backend";
import { statusClass } from "@/features/commit/statusColor";
import type { FileChangeKind } from "@/lib/backend";
import { useI18n } from "vue-i18n";

const sync = useSyncStore();
const { t } = useI18n();

function mapStatus(s: string): FileChangeKind {
  switch (s) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      return "modified";
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col p-2 text-sm">
    <div v-if="!sync.lastUpdate" class="p-4 text-xs text-muted-foreground">
      {{ t("syncUi.noUpdate") }}
    </div>
    <template v-else>
      <div class="border-b px-2 py-1 text-xs text-muted-foreground">
        {{ sync.lastUpdate.strategy }} · {{ sync.lastUpdate.message }}
        <span class="font-mono">
          ({{ sync.lastUpdate.oldHead.slice(0, 7) }} → {{ sync.lastUpdate.newHead.slice(0, 7) }})
        </span>
      </div>
      <div
        v-if="sync.lastUpdate.submoduleError || sync.lastUpdate.submodules?.items.length"
        class="max-h-40 shrink-0 overflow-auto border-b px-2 py-2 text-xs"
      >
        <div class="mb-1 font-medium">{{ t("syncUi.submodulesTitle") }}</div>
        <p
          v-if="sync.lastUpdate.submoduleError"
          role="alert"
          class="whitespace-pre-wrap text-destructive"
        >
          {{ sync.lastUpdate.submoduleError }}
        </p>
        <div
          v-for="item in sync.lastUpdate.submodules?.items ?? []"
          :key="item.path"
          class="mb-1 break-words"
        >
          <span class="font-mono">{{ item.path }}</span>
          ·
          {{
            t(
              item.updated
                ? "syncUi.submoduleUpdated"
                : item.skipped
                  ? "syncUi.submoduleSkipped"
                  : "syncUi.submoduleFailed",
            )
          }}
          <span v-if="item.oldSha || item.newSha" class="font-mono">
            ({{ item.oldSha?.slice(0, 7) ?? "—" }} → {{ item.newSha?.slice(0, 7) ?? "—" }})</span
          >
          <p
            v-if="!item.updated"
            class="whitespace-pre-wrap"
            :class="item.skipped ? 'text-muted-foreground' : 'text-destructive'"
          >
            {{ item.message }}
          </p>
        </div>
      </div>
      <div class="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-hidden p-2">
        <div class="flex min-h-0 flex-col overflow-hidden rounded-md border">
          <div class="border-b px-2 py-1 text-[11px] font-medium uppercase text-muted-foreground">
            {{ t("syncUi.files") }}
          </div>
          <PathTreeList
            :files="sync.lastUpdate.updatedFiles"
            :status-class="(f: ChangedFile) => statusClass(mapStatus(f.status))"
            :empty-text="t('syncUi.noFiles')"
          />
        </div>
        <div class="min-h-0 overflow-auto rounded-md border p-2">
          <div class="mb-1 text-[11px] font-medium uppercase text-muted-foreground">
            {{ t("syncUi.commits") }}
          </div>
          <div v-if="!sync.lastUpdate.commits.length" class="text-xs text-muted-foreground">
            {{ t("syncUi.noCommits") }}
          </div>
          <div v-for="c in sync.lastUpdate.commits" :key="c" class="font-mono text-[11px]">
            {{ c }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
