<script setup lang="ts">
import { ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { closeDialog } from "@/composables/useDialog";
import { getBackend } from "@/lib/backend";
import { isTauri } from "@/lib/utils";
import { toast } from "@/composables/useToast";
import { promptDialog } from "@/composables/useConfirm";

const url = ref("");
const dir = ref("");
const shallow = ref(false);
const depth = ref(1);
const openAfter = ref(true);
const urlOk = ref<boolean | null>(null);
let timer: ReturnType<typeof setTimeout> | null = null;

watch(url, (v) => {
  urlOk.value = null;
  if (timer) clearTimeout(timer);
  if (!v.trim()) return;
  timer = setTimeout(async () => {
    try {
      urlOk.value = await getBackend().cloneCheckUrl({ url: v.trim() });
    } catch {
      urlOk.value = false;
    }
  }, 600);
  // Suggest directory name from URL
  try {
    const base = v.trim().replace(/\.git$/, "").split("/").pop() || "repo";
    if (!dir.value) dir.value = `/tmp/${base}`;
  } catch {
    /* ignore */
  }
});

async function browse() {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string") dir.value = selected;
  } else {
    const p = await promptDialog({
      title: "Clone into directory",
      defaultValue: dir.value,
      allowEmpty: false,
    });
    if (p) dir.value = p;
  }
}

async function ok() {
  if (!url.value.trim() || !dir.value.trim()) return;
  try {
    const result = await getBackend().cloneRun({
      url: url.value.trim(),
      dir: dir.value.trim(),
      depth: shallow.value ? depth.value : null,
      branch: null,
      openAfter: openAfter.value,
    });
    toast({ title: "Cloned", description: result.path });
    closeDialog(result.path);
  } catch (e) {
    toast({ title: "Clone failed", description: String(e) });
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[50] flex items-center justify-center bg-black/40 p-4">
    <div class="w-full max-w-lg rounded-lg border bg-popover p-4 shadow-lg">
      <h2 class="text-sm font-semibold">Clone Repository</h2>
      <label class="mt-3 block text-[11px] text-muted-foreground">URL</label>
      <input v-model="url" class="mt-1 h-8 w-full rounded-md border bg-background px-2 text-sm font-mono" autofocus />
      <p class="mt-1 text-[11px]" :class="urlOk === false ? 'text-destructive' : 'text-muted-foreground'">
        <template v-if="urlOk === true">✓ Repository found</template>
        <template v-else-if="urlOk === false">✗ Cannot access (credentials may be required at clone)</template>
      </p>
      <label class="mt-3 block text-[11px] text-muted-foreground">Directory</label>
      <div class="mt-1 flex gap-2">
        <input v-model="dir" class="h-8 flex-1 rounded-md border bg-background px-2 text-sm font-mono" />
        <Button size="sm" variant="outline" @click="browse">Browse…</Button>
      </div>
      <label class="mt-3 flex items-center gap-2 text-xs">
        <input v-model="shallow" type="checkbox" /> Shallow clone, depth:
        <input v-model.number="depth" type="number" min="1" class="h-6 w-16 rounded border bg-background px-1" :disabled="!shallow" />
      </label>
      <label class="mt-1 flex items-center gap-2 text-xs">
        <input v-model="openAfter" type="checkbox" /> Open after clone
      </label>
      <div class="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" @click="closeDialog(null)">Cancel</Button>
        <Button size="sm" :disabled="!url.trim() || !dir.trim()" @click="ok">Clone</Button>
      </div>
    </div>
  </div>
</template>
