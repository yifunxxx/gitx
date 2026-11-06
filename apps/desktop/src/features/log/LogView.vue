<script setup lang="ts">
import { onMounted, watch } from "vue";
import { Pane, Splitpanes } from "splitpanes";
import { useLogStore } from "@/stores/logStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import EmptyState from "@/components/common/EmptyState.vue";
import ErrorState from "@/components/common/ErrorState.vue";
import { statusClass } from "@/features/commit/statusColor";
import type { FileChangeKind } from "@/lib/backend";

const log = useLogStore();
const workspace = useWorkspaceStore();

onMounted(() => {
  if (workspace.isRepo) void log.load(true);
});

watch(
  () => workspace.repoPath,
  () => {
    if (workspace.isRepo) void log.load(true);
  },
);

function formatTime(ts: number) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(ts * 1000));
  } catch {
    return String(ts);
  }
}

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

function laneColor(color: number) {
  return `rgb(var(--graph-lane-${color % 12}))`;
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <EmptyState
      v-if="!workspace.isRepo"
      title="No repository"
      description="Open or create a Git repository to see history."
    />
    <ErrorState v-else-if="log.error" title="Log failed" :message="log.error" />
    <EmptyState
      v-else-if="!log.loading && !log.commits.length"
      title="No commits yet"
      description="Make your first commit from the Commit tool window."
    />
    <Splitpanes v-else class="h-full">
      <Pane :size="58" min-size="30">
        <div class="flex h-full min-h-0 flex-col">
          <div
            class="grid h-7 shrink-0 grid-cols-[56px_1fr_120px_140px] items-center border-b px-2 text-[11px] text-muted-foreground"
          >
            <span>Graph</span>
            <span>Message</span>
            <span>Author</span>
            <span>Date</span>
          </div>
          <div class="min-h-0 flex-1 overflow-auto">
            <button
              v-for="c in log.commits"
              :key="c.sha"
              type="button"
              class="grid h-[22px] w-full grid-cols-[56px_1fr_120px_140px] items-center px-2 text-left text-[12.5px]"
              :class="log.selectedSha === c.sha ? 'bg-accent' : 'hover:bg-accent/40'"
              @click="log.select(c.sha)"
            >
              <span class="relative flex h-full items-center justify-center">
                <span
                  class="h-2.5 w-2.5 rounded-full ring-2 ring-background"
                  :style="{ background: laneColor(c.graph.color) }"
                />
              </span>
              <span class="flex min-w-0 items-center gap-1 truncate">
                <span
                  v-for="refName in c.refs.slice(0, 2)"
                  :key="refName"
                  class="shrink-0 rounded-sm bg-muted px-1 text-[10px] text-foreground"
                >
                  {{ refName }}
                </span>
                <span class="truncate">{{ c.subject }}</span>
              </span>
              <span class="truncate text-muted-foreground">{{ c.author }}</span>
              <span class="truncate text-muted-foreground">{{ formatTime(c.authorTime) }}</span>
            </button>
            <button
              v-if="log.truncated"
              type="button"
              class="w-full py-2 text-xs text-muted-foreground hover:text-foreground"
              @click="log.loadMore()"
            >
              Load more…
            </button>
          </div>
        </div>
      </Pane>
      <Pane :size="42" min-size="24">
        <Splitpanes horizontal class="h-full">
          <Pane :size="45">
            <div class="flex h-full min-h-0 flex-col">
              <div class="border-b px-2 py-1 text-[11px] font-medium">Changed Files</div>
              <div class="min-h-0 flex-1 overflow-auto text-[12px]">
                <div
                  v-for="f in log.changedFiles"
                  :key="f.path"
                  class="truncate px-2 py-0.5"
                  :class="statusClass(mapStatus(f.status))"
                >
                  {{ f.origPath ? `${f.origPath} → ${f.path}` : f.path }}
                </div>
              </div>
            </div>
          </Pane>
          <Pane :size="55">
            <div v-if="log.details" class="h-full overflow-auto p-2 text-[12px]">
              <div class="font-mono text-[11px] text-muted-foreground">{{ log.details.sha }}</div>
              <div class="mt-1 font-medium">{{ log.details.subject }}</div>
              <pre
                v-if="log.details.body"
                class="mt-1 whitespace-pre-wrap font-sans text-muted-foreground"
              >{{ log.details.body }}</pre>
              <dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <dt>Author</dt>
                <dd>{{ log.details.author }} &lt;{{ log.details.authorEmail }}&gt;</dd>
                <dt>Date</dt>
                <dd>{{ formatTime(log.details.authorTime) }}</dd>
                <dt>Parents</dt>
                <dd class="font-mono">
                  {{ log.details.parents.map((p) => p.slice(0, 7)).join(", ") || "—" }}
                </dd>
              </dl>
            </div>
          </Pane>
        </Splitpanes>
      </Pane>
    </Splitpanes>
  </div>
</template>
