<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { useUpdateStore } from "@/stores/updateStore";

defineProps<{ disabled?: boolean }>();

const { t } = useI18n();
const updates = useUpdateStore();

onMounted(() => {
  void updates.ensureCurrentVersion();
});

const status = computed(() => {
  if (updates.checking) return t("updates.checking");
  if (updates.error) return updates.error;
  if (updates.latest?.newer) {
    return t("updates.availableBody", {
      current: updates.latest.currentVersion,
    });
  }
  if (updates.latest) {
    return t("updates.upToDateBody", { version: updates.latest.currentVersion });
  }
  return t("updates.checkHint");
});
</script>

<template>
  <div class="space-y-4 text-xs">
    <div class="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-3 border-b border-border/40 py-1.5">
      <span class="font-medium">{{ t("updates.currentVersion") }}</span>
      <span class="font-mono">{{ updates.currentVersion ?? "…" }}</span>
    </div>
    <div
      v-if="updates.latest"
      class="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-center gap-3 border-b border-border/40 py-1.5"
    >
      <span class="font-medium">{{ t("updates.latestVersion") }}</span>
      <span class="font-mono">{{ updates.latest.latestVersion }}</span>
    </div>
    <p role="status" class="text-muted-foreground">{{ status }}</p>
    <div class="flex flex-wrap gap-2">
      <Button
        size="sm"
        variant="outline"
        :disabled="disabled || updates.checking"
        @click="updates.checkForUpdates({ manual: true })"
      >
        {{ updates.checking ? t("updates.checking") : t("updates.checkNow") }}
      </Button>
      <Button
        v-if="updates.latest?.newer"
        size="sm"
        :disabled="disabled"
        @click="updates.openReleasePage(updates.latest?.releaseUrl)"
      >
        {{ t("updates.openRelease") }}
      </Button>
      <Button
        v-if="updates.latest?.nsisUrl"
        size="sm"
        variant="outline"
        :disabled="disabled"
        @click="updates.openReleasePage(updates.latest?.nsisUrl)"
      >
        {{ t("updates.downloadNsis") }}
      </Button>
      <Button
        v-if="updates.latest?.msiUrl"
        size="sm"
        variant="outline"
        :disabled="disabled"
        @click="updates.openReleasePage(updates.latest?.msiUrl)"
      >
        {{ t("updates.downloadMsi") }}
      </Button>
    </div>
    <p class="text-[11px] text-muted-foreground">{{ t("updates.autoCheckHint") }}</p>
  </div>
</template>
