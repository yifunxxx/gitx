<script setup lang="ts">
import { Minus, Square, X } from "@lucide/vue";
import { computed, onMounted, ref } from "vue";
import { isTauri } from "@/lib/utils";

const platform = ref<"mac" | "win" | "linux">("linux");

onMounted(() => {
  const p = navigator.platform.toLowerCase();
  if (p.includes("mac")) platform.value = "mac";
  else if (p.includes("win")) platform.value = "win";
  else platform.value = "linux";
});

const showCustom = computed(() => platform.value !== "mac");

async function minimize() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().minimize();
}

async function toggleMax() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  if (await w.isMaximized()) await w.unmaximize();
  else await w.maximize();
}

async function close() {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().close();
}
</script>

<template>
  <div v-if="showCustom" class="flex items-center gap-0.5 pr-1">
    <button
      type="button"
      class="flex h-8 w-10 items-center justify-center text-muted-foreground hover:bg-accent"
      aria-label="Minimize"
      @click="minimize"
    >
      <Minus class="h-3.5 w-3.5" />
    </button>
    <button
      type="button"
      class="flex h-8 w-10 items-center justify-center text-muted-foreground hover:bg-accent"
      aria-label="Maximize"
      @click="toggleMax"
    >
      <Square class="h-3 w-3" />
    </button>
    <button
      type="button"
      class="flex h-8 w-10 items-center justify-center text-muted-foreground hover:bg-destructive/20 hover:text-destructive"
      aria-label="Close"
      @click="close"
    >
      <X class="h-3.5 w-3.5" />
    </button>
  </div>
</template>
