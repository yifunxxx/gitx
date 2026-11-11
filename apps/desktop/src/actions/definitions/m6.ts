import { Archive, Eye, FilePlus2, ListPlus, Package } from "@lucide/vue";
import { registerAction } from "../registry";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useChangesStore } from "@/stores/changesStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useStashShelfStore } from "@/stores/stashShelfStore";
import { getBackend } from "@/lib/backend";
import { toast } from "@/composables/useToast";
import { promptDialog } from "@/composables/useConfirm";

function hasRepo() {
  const ws = useWorkspaceStore();
  return !!ws.folderPath && !!ws.isRepo;
}

export function registerM6Actions() {
  registerAction({
    id: "Git.Stash",
    title: "Stash Changes…",
    description: "Stash local changes",
    icon: Archive,
    scope: "global",
    enabled: () => hasRepo() && !useStashShelfStore().busy,
    async run() {
      await useStashShelfStore().promptStash();
    },
  });

  registerAction({
    id: "Git.Show.Stash",
    title: "Show Stashes…",
    description: "Open Stashes & Shelves tool window",
    icon: Archive,
    scope: "global",
    enabled: () => hasRepo(),
    async run() {
      const layout = useLayoutStore();
      const stash = useStashShelfStore();
      layout.bottomOpen = true;
      layout.activeBottomTab = stash.combineTab ? "stashesShelves" : "stash";
      await stash.refresh();
    },
  });

  registerAction({
    id: "ChangesView.NewChangeList",
    title: "New Changelist…",
    description: "Create a changelist",
    icon: ListPlus,
    scope: "changes",
    enabled: () => hasRepo() && !useChangesStore().stagingMode,
    async run() {
      const ws = useWorkspaceStore();
      const path = ws.repoPath;
      const navigation = ws.navigationToken();
      const current = () =>
        ws.isRepo && ws.repoPath === path && ws.navigationToken() === navigation;
      const name = await promptDialog({ title: "New Changelist…", allowEmpty: false });
      if (!name?.trim() || !current()) return;
      const created = await useChangesStore().createChangelist(name.trim(), true);
      if (created && current()) toast({ title: "Changelist created", description: name.trim() });
    },
  });

  registerAction({
    id: "Git.Ignore.File",
    title: "Ignore File…",
    description: "Add selected paths to .gitignore",
    scope: "changes",
    enabled: () => hasRepo() && useChangesStore().selectedPaths.length > 0,
    async run() {
      const changes = useChangesStore();
      await changes.ignore(changes.selectedPaths);
      toast({ title: "Ignored", description: `${changes.selectedPaths.length} path(s)` });
    },
  });

  registerAction({
    id: "Git.OpenExcludeFile",
    title: "Open .git/info/exclude",
    description: "Open or create the exclude file",
    icon: Eye,
    scope: "global",
    enabled: () => hasRepo(),
    async run() {
      const ws = useWorkspaceStore();
      if (!ws.repoPath) return;
      const path = await getBackend().excludeOpen({ path: ws.repoPath });
      toast({ title: "Exclude file", description: path });
    },
  });

  registerAction({
    id: "Git.Shelve",
    title: "Shelve Changes…",
    description: "Shelve selected paths",
    icon: Package,
    scope: "changes",
    enabled: () =>
      hasRepo() && useChangesStore().selectedPaths.length > 0 && !useStashShelfStore().busy,
    async run() {
      await useStashShelfStore().promptShelf(useChangesStore().selectedPaths);
    },
  });

  registerAction({
    id: "Git.Shelf.ImportPatch",
    title: "Import Patch…",
    description: "Save a patch in Shelf",
    icon: FilePlus2,
    scope: "global",
    enabled: () => hasRepo() && !useStashShelfStore().busy,
    async run() {
      const shelf = useStashShelfStore();
      if (await shelf.promptImportShelf()) {
        const layout = useLayoutStore();
        layout.bottomOpen = true;
        layout.activeBottomTab = shelf.combineTab ? "stashesShelves" : "shelf";
      }
    },
  });

  registerAction({
    id: "Create Patch",
    title: "Create Patch…",
    description: "Create a patch from local changes",
    icon: FilePlus2,
    scope: "global",
    enabled: () => hasRepo(),
    async run(ctx) {
      const ws = useWorkspaceStore();
      const changes = useChangesStore();
      if (!ws.repoPath) return;
      const paths = ctx.selection.files
        ? [...ctx.selection.files]
        : changes.selectedPaths.length
          ? [...changes.selectedPaths]
          : changes.checkedPaths.length
            ? [...changes.checkedPaths]
            : [];
      const result = await getBackend().patchCreate({
        path: ws.repoPath,
        paths,
        output: null,
        base: null,
      });
      toast({
        title: "Patch created",
        description: `${result.path} (${result.bytes} bytes)`,
      });
    },
  });
}
