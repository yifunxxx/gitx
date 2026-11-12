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
  Math.max(72, 28 + (jobs.running.length || 1) * 56),
);

function detailFor(job: JobUi) {
  if (job.message) return job.message;
  if (job.percent != null) return t("status.jobPercent", { percent: Math.round(job.percent) });
  return t("status.jobRunning");
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
    :label="t('status.jobsTitle')"
    :open="jobs.popupOpen"
    :anchor-x="jobs.anchorX"
    :anchor-y="jobs.anchorY"
    :width="320"
    :estimated-height="estimatedHeight"
    min-width-class="min-w-72"
    @close="jobs.closePopup()"
  >
    <div class="px-2 py-1 text-[11px] font-medium text-muted-foreground">
      {{ t("status.jobsTitle") }}
    </div>
    <div
      v-if="!jobs.running.length"
      class="px-2 py-2 text-[12px] text-muted-foreground"
      role="menuitem"
      tabindex="-1"
    >
      {{ t("status.jobsEmpty") }}
    </div>
    <div
      v-for="job in jobs.running"
      :key="job.id"
      class="flex items-start gap-2 rounded px-2 py-1.5"
    >
      <LoaderCircle class="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-[13px] leading-4 text-foreground">{{ job.title }}</div>
        <div class="mt-0.5 truncate text-[11px] text-muted-foreground">
          {{ detailFor(job) }}
        </div>
        <div
          v-if="job.percent != null"
          class="mt-1 h-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          :aria-valuenow="Math.round(job.percent)"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div
            class="h-full bg-primary transition-[width] duration-150"
            :style="{ width: `${Math.min(100, Math.max(0, job.percent))}%` }"
          />
        </div>
      </div>
      <button
        v-if="job.cancellable"
        type="button"
        role="menuitem"
        class="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
        @click="onCancel(job.id)"
      >
        {{ t("common.cancel") }}
      </button>
    </div>
  </ContextMenuSurface>
</template>
