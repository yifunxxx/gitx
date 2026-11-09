<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { Button } from "@/components/ui/button";
import { useStashShelfStore } from "@/stores/stashShelfStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useI18n } from "vue-i18n";
import { promptDialog } from "@/composables/useConfirm";

const props = defineProps<{
  mode: "combined" | "stash" | "shelf";
}>();

const { t } = useI18n();
const store = useStashShelfStore();
const workspace = useWorkspaceStore();
const reinstateIndex = ref(false);
const removeAppliedShelf = ref(false);

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
  await store.promptStash();
}

async function renameSelectedShelf() {
  if (!store.selectedShelfId) return;
  const current = store.shelves.find((s) => s.id === store.selectedShelfId);
  const repository = store.repositoryToken();
  const message = await promptDialog({
    title: t("shelf.rename"),
    defaultValue: current?.message ?? "",
    placeholder: t("shelf.renamePrompt"),
    allowEmpty: false,
  });
  if (
    message == null ||
    !message.trim() ||
    !current ||
    repository !== store.repositoryToken() ||
    !store.shelves.some((s) => s.id === current.id)
  )
    return;
  await store.renameShelf(current.id, message.trim());
}

function moveSelection(event: KeyboardEvent, index: number, kind: "stash" | "shelf") {
  const count = kind === "stash" ? store.stashes.length : store.shelves.length;
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? count - 1
        : event.key === "ArrowDown"
          ? Math.min(count - 1, index + 1)
          : event.key === "ArrowUp"
            ? Math.max(0, index - 1)
            : null;
  if (next == null) return;
  event.preventDefault();
  if (kind === "stash") store.selectedStashSha = store.stashes[next]!.sha;
  else store.selectedShelfId = store.shelves[next]!.id;
  const parent = (event.currentTarget as HTMLElement).parentElement;
  parent?.querySelectorAll<HTMLButtonElement>(`[data-entry="${kind}"]`)[next]?.focus();
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
      <Button v-if="showStashes" size="xs" variant="ghost" :disabled="store.busy" @click="newStash">
        {{ t("stash.create") }}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        :disabled="store.busy || store.loading"
        @click="store.refresh()"
        >{{ t("actions.refreshStatus") }}</Button
      >
    </div>

    <div v-if="store.error" role="alert" class="px-2 py-1 text-destructive">{{ store.error }}</div>
    <div
      v-else-if="store.loading && !store.stashes.length && !store.shelves.length"
      class="p-2 text-muted-foreground"
    >
      {{ t("common.loading") }}
    </div>

    <div class="min-h-0 flex-1 overflow-auto">
      <template v-if="showStashes">
        <div class="px-2 py-1 font-medium text-muted-foreground">{{ t("stash.section") }}</div>
        <button
          v-for="(s, index) in store.stashes"
          :key="s.sha"
          type="button"
          data-entry="stash"
          :aria-pressed="store.selectedStashSha === s.sha"
          class="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left hover:bg-accent/50 focus-visible:outline focus-visible:outline-ring"
          :class="store.selectedStashSha === s.sha ? 'bg-accent' : ''"
          @click="store.selectedStashSha = s.sha"
          @keydown="moveSelection($event, index, 'stash')"
        >
          <span class="font-mono text-muted-foreground">{{ store.stashRefOf(s) }}</span>
          <span class="truncate">{{ s.message }}</span>
        </button>
        <div v-if="!store.stashes.length" class="px-3 py-2 text-muted-foreground">
          {{ t("stash.empty") }}
        </div>
        <fieldset
          v-if="store.selectedStash"
          :disabled="store.busy"
          class="flex flex-wrap items-center gap-1 border-b px-2 py-1"
        >
          <label class="mr-2 flex items-center gap-1"
            ><input v-model="reinstateIndex" type="checkbox" />{{
              t("stash.reinstateIndex")
            }}</label
          >
          <Button
            size="xs"
            variant="outline"
            @click="store.applyStash(store.selectedStash!.sha, reinstateIndex)"
          >
            {{ t("stash.apply") }}
          </Button>
          <Button
            size="xs"
            variant="outline"
            @click="store.popStash(store.selectedStash!.sha, reinstateIndex)"
          >
            {{ t("stash.pop") }}
          </Button>
          <Button size="xs" variant="outline" @click="store.dropStash(store.selectedStash!.sha)">
            {{ t("stash.drop") }}
          </Button>
          <Button size="xs" variant="ghost" @click="store.clearStashes()">
            {{ t("stash.clear") }}
          </Button>
        </fieldset>
      </template>

      <template v-if="showShelves">
        <div class="px-2 py-1 font-medium text-muted-foreground">{{ t("shelf.section") }}</div>
        <button
          v-for="(s, index) in store.shelves"
          :key="s.id"
          type="button"
          data-entry="shelf"
          :aria-pressed="store.selectedShelfId === s.id"
          class="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left hover:bg-accent/50 focus-visible:outline focus-visible:outline-ring"
          :class="store.selectedShelfId === s.id ? 'bg-accent' : ''"
          @click="store.selectedShelfId = s.id"
          @keydown="moveSelection($event, index, 'shelf')"
        >
          <span class="truncate">{{ s.message }}</span>
          <span class="text-muted-foreground">({{ s.paths.length }})</span>
        </button>
        <div v-if="!store.shelves.length" class="px-3 py-2 text-muted-foreground">
          {{ t("shelf.empty") }}
        </div>
        <fieldset
          v-if="store.selectedShelfId"
          :disabled="store.busy"
          class="flex flex-wrap gap-1 px-2 py-1"
        >
          <Button
            size="xs"
            variant="outline"
            @click="store.unshelve(store.selectedShelfId!, removeAppliedShelf)"
          >
            {{ t("shelf.unshelve") }}
          </Button>
          <label class="flex items-center gap-1 text-[11px]">
            <input v-model="removeAppliedShelf" type="checkbox" />
            {{ t("shelf.removeApplied") }}
          </label>
          <Button size="xs" variant="outline" @click="renameSelectedShelf">
            {{ t("shelf.rename") }}
          </Button>
          <Button size="xs" variant="outline" @click="store.deleteShelf(store.selectedShelfId!)">
            {{ t("shelf.delete") }}
          </Button>
        </fieldset>
      </template>
    </div>
  </div>
</template>
