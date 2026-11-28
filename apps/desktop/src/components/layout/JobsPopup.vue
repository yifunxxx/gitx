<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { LoaderCircle } from "@lucide/vue";
import ContextMenuSurface from "@/components/common/ContextMenuSurface.vue";
import { useJobsStore, type JobUi } from "@/stores/jobsStore";
import { toast } from "@/composables/useToast";
import { formatErrorMessage } from "@/lib/errors";

const { t } = useI18n();
const jobs = useJobsStore();

const estimatedHeight = computed(() =>
  Math.max(
    72,
    28 + jobs.running.length * 56 + (jobs.refreshError ? 124 : 0) + (jobs.refreshing ? 32 : 0),
  ),
);

function retryRefresh() {
  void jobs.refresh().catch(() => {
    // The store retains the failure in the panel, including background polls.
  });
}

function detailFor(job: JobUi) {
  if (job.cancelling) return t("status.jobCancelling");
  if (job.message) return job.message;
  if (job.percent != null) return t("status.jobPercent", { percent: Math.round(job.percent) });
  return t("status.jobRunning");
}

function jobLabel(job: JobUi) {
  return job.message ? `${job.title} — ${job.message}` : job.title;
}

async function onCancel(id: string) {
  try {
    await jobs.cancel(id);
  } catch (error) {
    toast({ title: t("status.cancelFailed"), description: formatErrorMessage(error) });
  }
}
</script>

<template>
  <ContextMenuSurface
    role="dialog"
    :label="t('status.jobsTitle')"
    :open="jobs.popupOpen"
    :anchor-x="jobs.anchorX"
    :anchor-y="jobs.anchorY"
    :width="320"
    :estimated-height="estimatedHeight"
    min-width-class="w-80 max-w-[calc(100vw-20px)]"
    @close="jobs.closePopup()"
  >
    <div class="px-2 py-1 text-[11px] font-medium text-muted-foreground">
      {{ t("status.jobsTitle") }}
    </div>
    <div v-if="jobs.refreshError" class="px-2 py-2 text-xs">
      <p
        role="alert"
        class="max-h-28 overflow-auto whitespace-pre-wrap break-words text-destructive"
      >
        {{ t("status.jobsRefreshFailed") }} {{ jobs.refreshError }}
      </p>
      <button
        data-jobs-retry
        type="button"
        :disabled="jobs.refreshing"
        :aria-busy="jobs.refreshing"
        class="mt-1 rounded border px-2 py-1 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
        @click="retryRefresh"
      >
        {{ t("common.retry") }}
      </button>
    </div>
    <div
      v-if="jobs.refreshing"
      role="status"
      class="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground"
    >
      <LoaderCircle class="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
      {{ t("status.jobsLoading") }}
    </div>
    <div
      v-if="!jobs.running.length && !jobs.refreshing && !jobs.refreshError"
      class="px-2 py-2 text-[12px] text-muted-foreground"
    >
      {{ t("status.jobsEmpty") }}
    </div>
    <div
      v-for="job in jobs.running"
      :key="job.id"
      class="flex items-start gap-2 rounded px-2 py-1.5"
    >
      <LoaderCircle
        class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none text-muted-foreground"
      />
      <div class="min-w-0 flex-1">
        <div class="truncate text-[13px] leading-4 text-foreground" :title="job.title">
          {{ job.title }}
        </div>
        <div class="mt-0.5 truncate text-[11px] text-muted-foreground" :title="detailFor(job)">
          {{ detailFor(job) }}
        </div>
        <div
          v-if="job.percent != null"
          class="mt-1 h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          :aria-label="jobLabel(job)"
          :aria-valuenow="Math.round(job.percent)"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="h-full bg-primary transition-[width] duration-150 motion-reduce:transition-none"
            :style="{ width: `${Math.min(100, Math.max(0, job.percent))}%` }"
          />
        </div>
      </div>
      <button
        v-if="job.cancellable"
        type="button"
        :aria-label="`${t(job.cancelling ? 'status.jobCancelling' : 'common.cancel')} — ${jobLabel(job)}`"
        :disabled="job.cancelling"
        :aria-disabled="job.cancelling || undefined"
        class="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px] disabled:cursor-wait disabled:opacity-50"
        @click="onCancel(job.id)"
      >
        {{ t(job.cancelling ? "status.jobCancelling" : "common.cancel") }}
      </button>
    </div>
  </ContextMenuSurface>
</template>
