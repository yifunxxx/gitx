<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { X } from "@lucide/vue";
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuPortal,
  ContextMenuContent,
  ContextMenuItem,
} from "reka-ui";

const props = defineProps<{
  tabKey: string;
  title: string;
  active: boolean;
  closable: boolean;
  hasOthers: boolean;
  hasRight: boolean;
  hasTabs: boolean;
  busy: boolean;
  menuEpoch: number;
}>();
const emit = defineEmits<{
  activate: [];
  close: [scope: "current" | "others" | "right" | "all"];
}>();
const { t } = useI18n();
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
watch(
  () => [props.menuEpoch, props.busy],
  () => {
    open.value = false;
  },
);

function onKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if ((event.key === "ContextMenu" && !event.shiftKey) || (event.key === "F10" && event.shiftKey)) {
    event.preventDefault();
    event.stopPropagation();
    if (!props.busy) open.value = true;
  }
}

function close(scope: "current" | "others" | "right" | "all") {
  open.value = false;
  emit("close", scope);
}

function restoreFocus(event: Event) {
  event.preventDefault();
  const active = document.activeElement;
  // A close action may have opened a confirmation dialog or focused a surviving
  // tab. Restore only while focus still belongs to this dismissed menu.
  if (!active || active === document.body || active.closest("[data-editor-tab-menu]")) {
    trigger.value?.focus({ preventScroll: true });
  }
}
</script>

<template>
  <ContextMenuRoot v-model:open="open" :modal="false">
    <ContextMenuTrigger as-child :disabled="busy">
      <div
        class="group flex shrink-0 items-center rounded-sm"
        :class="
          active
            ? 'bg-background text-foreground ring-1 ring-border'
            : 'text-muted-foreground hover:bg-accent'
        "
        @contextmenu.stop="trigger?.focus({ preventScroll: true })"
        @keydown="onKeydown"
      >
        <button
          ref="trigger"
          type="button"
          :data-editor-key="tabKey"
          :title="title"
          :aria-pressed="active"
          class="max-w-[180px] truncate rounded-sm px-2 py-0.5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring"
          @click="emit('activate')"
        >
          {{ title }}
        </button>
        <button
          v-if="closable"
          type="button"
          tabindex="-1"
          :title="t('editorTabs.closeCurrent')"
          :aria-label="t('editorTabs.closeNamed', { title })"
          :disabled="busy"
          class="mr-1 rounded p-0.5 opacity-0 hover:bg-accent focus:opacity-100 group-hover:opacity-100 disabled:opacity-40"
          @click.stop="close('current')"
        >
          <X class="h-3 w-3" />
        </button>
      </div>
    </ContextMenuTrigger>
    <ContextMenuPortal>
      <ContextMenuContent
        data-editor-tab-menu
        loop
        :collision-padding="8"
        :aria-label="t('editorTabs.menu')"
        class="z-[9999] min-w-44 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg ring-1 ring-foreground/10"
        :style="{ maxHeight: 'var(--reka-context-menu-content-available-height)' }"
        @close-auto-focus="restoreFocus"
      >
        <ContextMenuItem
          v-for="action in [
            { scope: 'current' as const, label: 'closeCurrent', enabled: closable },
            { scope: 'others' as const, label: 'closeOthers', enabled: hasOthers },
            { scope: 'right' as const, label: 'closeRight', enabled: hasRight },
            { scope: 'all' as const, label: 'closeAll', enabled: hasTabs },
          ]"
          :key="action.scope"
          :data-close-scope="action.scope"
          :disabled="busy || !action.enabled"
          class="cursor-default select-none rounded px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-hover-surface data-[disabled]:opacity-40"
          @select="close(action.scope)"
          >{{ t(`editorTabs.${action.label}`) }}</ContextMenuItem
        >
      </ContextMenuContent>
    </ContextMenuPortal>
  </ContextMenuRoot>
</template>
