<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";

const props = withDefaults(
  defineProps<{
    title: string;
    message?: string;
    defaultValue?: string;
    placeholder?: string;
    confirmLabel?: string;
    allowEmpty?: boolean;
  }>(),
  {
    defaultValue: "",
    allowEmpty: true,
  },
);

const { t } = useI18n();
const value = ref(props.defaultValue);
const inputEl = ref<HTMLInputElement | null>(null);
const canConfirm = computed(() => props.allowEmpty || !!value.value.trim());

onMounted(async () => {
  await nextTick();
  inputEl.value?.focus();
  inputEl.value?.select();
});

function confirm() {
  if (!canConfirm.value) return;
  closeDialog(value.value);
}

function onEnter(event: KeyboardEvent) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229 ||
    event.repeat ||
    !canConfirm.value
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  confirm();
}

function cancel() {
  closeDialog(null);
}

function onEscape(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat) return;
  event.preventDefault();
  event.stopPropagation();
  cancel();
}
</script>

<template>
  <div
    class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4 animate-in fade-in duration-100"
    @keydown.esc="onEscape"
  >
    <div
      class="w-full max-w-md rounded-lg border bg-popover p-4 shadow-lg animate-in zoom-in-95 duration-100"
      role="dialog"
      aria-modal="true"
    >
      <h2 class="text-sm font-semibold">{{ props.title }}</h2>
      <p v-if="props.message" class="mt-2 text-xs text-muted-foreground">{{ props.message }}</p>
      <input
        ref="inputEl"
        v-model="value"
        type="text"
        class="mt-3 h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        :placeholder="props.placeholder"
        @keydown.enter="onEnter"
      />
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="cancel">{{ t("common.cancel") }}</Button>
        <Button size="sm" @click="confirm">
          {{ props.confirmLabel ?? t("common.ok") }}
        </Button>
      </div>
    </div>
  </div>
</template>
