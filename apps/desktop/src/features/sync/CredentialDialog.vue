<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { useSettingsStore } from "@/stores/settingsStore";

export type CredentialDialogResult = {
  username: string;
  password: string;
  storeHelper: boolean;
  retry: boolean;
} | null;

const props = withDefaults(
  defineProps<{
    title?: string;
    message?: string;
    url?: string | null;
    host?: string | null;
    protocol?: string | null;
    username?: string | null;
    errorText?: string | null;
  }>(),
  {
    url: null,
    host: null,
    protocol: null,
    username: null,
    errorText: null,
  },
);

const { t } = useI18n();
const settings = useSettingsStore();

const username = ref(props.username ?? "");
const password = ref("");
const storeHelper = ref(settings.settings?.git?.useCredentialHelper ?? true);
const userEl = ref<HTMLInputElement | null>(null);
const passEl = ref<HTMLInputElement | null>(null);

const displayTarget = computed(() => {
  if (props.url) return props.url;
  if (props.host) {
    const proto = props.protocol || "https";
    return `${proto}://${props.host}`;
  }
  return "";
});

onMounted(async () => {
  await nextTick();
  if (username.value) passEl.value?.focus();
  else userEl.value?.focus();
});

function submit(retry: boolean) {
  if (!username.value.trim() || !password.value) return;
  closeDialog({
    username: username.value.trim(),
    password: password.value,
    storeHelper: storeHelper.value,
    retry,
  } satisfies NonNullable<CredentialDialogResult>);
}

function cancel() {
  closeDialog(null);
}
</script>

<template>
  <div
    class="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-100"
    @keydown.esc="cancel"
  >
    <div
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg animate-in zoom-in-95 duration-100"
      role="dialog"
      aria-modal="true"
      @keydown.enter.prevent="submit(true)"
    >
      <h2 class="text-sm font-semibold">
        {{ props.title ?? t("auth.title") }}
      </h2>
      <p class="mt-2 text-xs text-muted-foreground">
        {{ props.message ?? t("auth.hint") }}
      </p>
      <p
        v-if="displayTarget"
        class="mt-2 truncate rounded-md bg-muted/60 px-2 py-1 font-mono text-[11px] text-foreground"
        :title="displayTarget"
      >
        {{ displayTarget }}
      </p>
      <p
        v-if="props.errorText"
        class="mt-2 max-h-16 overflow-auto whitespace-pre-wrap text-[11px] text-destructive"
      >
        {{ props.errorText }}
      </p>

      <label class="mt-3 block text-[11px] text-muted-foreground">
        {{ t("auth.username") }}
        <input
          ref="userEl"
          v-model="username"
          type="text"
          autocomplete="username"
          class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </label>
      <label class="mt-2 block text-[11px] text-muted-foreground">
        {{ t("auth.password") }}
        <input
          ref="passEl"
          v-model="password"
          type="password"
          autocomplete="current-password"
          class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </label>

      <label class="mt-3 flex items-start gap-2 text-xs">
        <input v-model="storeHelper" type="checkbox" class="mt-0.5" />
        <span>
          <span class="font-medium">{{ t("auth.useCredentialHelper") }}</span>
          <span class="mt-0.5 block text-[11px] text-muted-foreground">{{
            t("auth.storeHint")
          }}</span>
        </span>
      </label>

      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="cancel">{{ t("common.cancel") }}</Button>
        <Button size="sm" :disabled="!username.trim() || !password" @click="submit(true)">
          {{ t("auth.saveAndRetry") }}
        </Button>
      </div>
    </div>
  </div>
</template>
