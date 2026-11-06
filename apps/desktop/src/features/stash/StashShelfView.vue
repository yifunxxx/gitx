<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { Button } from "@/components/ui/button";
import { useStashShelfStore } from "@/stores/stashShelfStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  mode: "combined" | "stash" | "shelf";
}>();

const { t } = useI18n();
const store = useStashShelfStore();
const workspace = useWorkspaceStore();

const showStashes = computed(() => props.mode === "combined" || props.mode === "stash");
const showShelves = computed(() => props.mode === "combined" || props.mode === "shelf");

onMounted(() => {
  if (workspace.isRepo) void store.refresh();
});

watch(
  () => workspace.repoPath,
  () => {
    if (workspace.isRepo) void store.refresh();
  },
);

async function newStash() {
  const message = window.prompt(t("stash.messagePrompt"), "WIP");
  if (message == null) return;
  await store.createStash(message || "WIP");
}

async function renameSelectedShelf() {
  if (!store.selectedShelfId) return;
  const current = store.shelves.find((s) => s.id === store.selectedShelfId);
  const message = window.prompt(t("shelf.renamePrompt"), current?.message ?? "");
  if (message == null || !message.trim()) return;
  await store.renameShelf(store.selectedShelfId, message.trim());
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col text-xs">
    <div class="flex h-8 items-center gap-1 border-b px-2">
      <span class="font-medium">
        {{
          props.mode === "combined"
            ? t("toolWindows.stashesShelves")
            : props.mode === "stash"
              ? t("toolWindows.stash")
              : t("toolWindows.shelf")
        }}
      </span>
      <div class="flex-1" />
      <Button v-if="showStashes" size="xs" variant="ghost" @click="newStash">
        {{ t("stash.create") }}
      </Button>
      <Button size="xs" variant="ghost" @click="store.refresh()">{{ t("actions.refreshStatus") }}</Button>
    </div>

    <div v-if="store.error" class="px-2 py-1 text-destructive">{{ store.error }}</div>
    <div v-else-if="store.loading && !store.stashes.length && !store.shelves.length" class="p-2 text-muted-foreground">
      Loading…
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <template v-if="showStashes">
        <div class="px-2 py-1 font-medium text-muted-foreground">{{ t("stash.section") }}</div>
        <div
          v-for="s in store.stashes"
          :key="s.sha"
          class="flex cursor-default items-center gap-2 px-2 py-1 hover:bg-accent/50"
          :class="store.selectedStashRef === store.stashRefOf(s) ? 'bg-accent' : ''"
          @click="store.selectedStashRef = store.stashRefOf(s)"
        >
          <span class="font-mono text-muted-foreground">{{ store.stashRefOf(s) }}</span>
          <span class="truncate">{{ s.message }}</span>
        </div>
        <div v-if="!store.stashes.length" class="px-3 py-2 text-muted-foreground">
          {{ t("stash.empty") }}
        </div>
        <div v-if="store.selectedStashRef" class="flex flex-wrap gap-1 border-b px-2 py-1">
          <Button size="xs" variant="outline" @click="store.applyStash(store.selectedStashRef!)">
            {{ t("stash.apply") }}
          </Button>
          <Button size="xs" variant="outline" @click="store.popStash(store.selectedStashRef!)">
            {{ t("stash.pop") }}
          </Button>
          <Button size="xs" variant="outline" @click="store.dropStash(store.selectedStashRef!)">
            {{ t("stash.drop") }}
          </Button>
          <Button size="xs" variant="ghost" @click="store.clearStashes()">
            {{ t("stash.clear") }}
          </Button>
        </div>
      </template>

      <template v-if="showShelves">
        <div class="px-2 py-1 font-medium text-muted-foreground">{{ t("shelf.section") }}</div>
        <div
          v-for="s in store.shelves"
          :key="s.id"
          class="flex cursor-default items-center gap-2 px-2 py-1 hover:bg-accent/50"
          :class="store.selectedShelfId === s.id ? 'bg-accent' : ''"
          @click="store.selectedShelfId = s.id"
        >
          <span class="truncate">{{ s.message }}</span>
          <span class="text-muted-foreground">({{ s.paths.length }})</span>
        </div>
        <div v-if="!store.shelves.length" class="px-3 py-2 text-muted-foreground">
          {{ t("shelf.empty") }}
        </div>
        <div v-if="store.selectedShelfId" class="flex flex-wrap gap-1 px-2 py-1">
          <Button size="xs" variant="outline" @click="store.unshelve(store.selectedShelfId!)">
            {{ t("shelf.unshelve") }}
          </Button>
          <Button size="xs" variant="outline" @click="renameSelectedShelf">
            {{ t("shelf.rename") }}
          </Button>
          <Button size="xs" variant="outline" @click="store.deleteShelf(store.selectedShelfId!)">
            {{ t("shelf.delete") }}
          </Button>
        </div>
      </template>
    </div>
  </div>
</template>
