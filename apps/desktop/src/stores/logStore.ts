import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { getBackend } from "@/lib/backend";
import type {
  ChangedFile,
  CommitDetails,
  IndexStatus,
  LogCommit,
  LogFilters,
  LogOrder,
} from "@/lib/backend";
import { useWorkspaceStore } from "./workspaceStore";
import { formatErrorMessage } from "@/lib/errors";

const emptyFilters = (): LogFilters => ({
  text: null,
  regex: false,
  matchCase: false,
  authors: [],
  since: null,
  until: null,
  paths: [],
  revisions: [],
  firstParent: false,
  noMerges: false,
  order: "date",
});

export const useLogStore = defineStore("log", () => {
  const commits = ref<LogCommit[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const truncated = ref(false);
  const nextOffset = ref(0);
  const selectedSha = ref<string | null>(null);
  const selectedShas = ref<string[]>([]);
  const details = ref<CommitDetails | null>(null);
  const changedFiles = ref<ChangedFile[]>([]);
  const filters = ref<LogFilters>(emptyFilters());
  const showGraphOptions = ref(false);
  const compactRefs = ref(true);
  const showTagNames = ref(true);
  const indexStatus = ref<IndexStatus | null>(null);
  const goToInput = ref("");

  const activeFilterChips = computed(() => {
    const chips: { key: string; label: string }[] = [];
    if (filters.value.text) chips.push({ key: "text", label: `Text: ${filters.value.text}` });
    if (filters.value.authors?.length)
      chips.push({ key: "authors", label: `User: ${filters.value.authors.join(", ")}` });
    if (filters.value.since) chips.push({ key: "since", label: `Since: ${filters.value.since}` });
    if (filters.value.until) chips.push({ key: "until", label: `Until: ${filters.value.until}` });
    if (filters.value.paths?.length)
      chips.push({ key: "paths", label: `Paths: ${filters.value.paths.join(", ")}` });
    if (filters.value.revisions?.length)
      chips.push({ key: "revisions", label: `Branch: ${filters.value.revisions.join(" ")}` });
    if (filters.value.firstParent) chips.push({ key: "firstParent", label: "First parent" });
    if (filters.value.noMerges) chips.push({ key: "noMerges", label: "No merges" });
    return chips;
  });

  async function load(reset = true) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId || !workspace.isRepo) {
      commits.value = [];
      return;
    }
    loading.value = true;
    error.value = null;
    try {
      const backend = getBackend();
      const offset = reset ? 0 : nextOffset.value;
      const page = await backend.logQuery({
        repoId: workspace.repoId,
        path: workspace.repoPath,
        offset,
        limit: 100,
        filters: filters.value,
      });
      commits.value = reset ? page.commits : [...commits.value, ...page.commits];
      truncated.value = page.truncated;
      nextOffset.value = page.nextOffset;
      if (reset) {
        selectedSha.value = null;
        selectedShas.value = [];
      }
      if (!selectedSha.value && page.commits[0]) {
        await select(page.commits[0].sha);
      }
      void refreshIndexStatus();
    } catch (e) {
      error.value = formatErrorMessage(e);
    } finally {
      loading.value = false;
    }
  }

  async function select(sha: string, multi = false) {
    if (multi) {
      if (selectedShas.value.includes(sha)) {
        selectedShas.value = selectedShas.value.filter((s) => s !== sha);
      } else {
        selectedShas.value = [...selectedShas.value, sha].slice(-2);
      }
      selectedSha.value = sha;
    } else {
      selectedSha.value = sha;
      selectedShas.value = [sha];
    }
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    const backend = getBackend();
    const [d, files] = await Promise.all([
      backend.logCommitDetails({ path: workspace.repoPath, sha }),
      backend.logChangedFiles({ path: workspace.repoPath, sha }),
    ]);
    details.value = d;
    changedFiles.value = files;
  }

  async function loadMore() {
    if (!truncated.value || loading.value) return;
    await load(false);
  }

  function setTextFilter(text: string) {
    filters.value = { ...filters.value, text: text || null };
  }

  function setAuthorFilter(author: string) {
    filters.value = {
      ...filters.value,
      authors: author ? [author] : [],
    };
  }

  function setDatePreset(preset: "24h" | "7d" | "all") {
    if (preset === "all") {
      filters.value = { ...filters.value, since: null, until: null };
      return;
    }
    filters.value = {
      ...filters.value,
      since: preset === "24h" ? "24.hours" : "7.days",
      until: null,
    };
  }

  function setPathsFilter(paths: string[]) {
    filters.value = { ...filters.value, paths };
  }

  function setRevisions(revisions: string[]) {
    filters.value = { ...filters.value, revisions };
  }

  function setOrder(order: LogOrder) {
    filters.value = { ...filters.value, order };
  }

  function toggleFirstParent() {
    filters.value = { ...filters.value, firstParent: !filters.value.firstParent };
  }

  function toggleNoMerges() {
    filters.value = { ...filters.value, noMerges: !filters.value.noMerges };
  }

  function clearFilter(key: string) {
    const next = { ...filters.value };
    switch (key) {
      case "text":
        next.text = null;
        break;
      case "authors":
        next.authors = [];
        break;
      case "since":
        next.since = null;
        break;
      case "until":
        next.until = null;
        break;
      case "paths":
        next.paths = [];
        break;
      case "revisions":
        next.revisions = [];
        break;
      case "firstParent":
        next.firstParent = false;
        break;
      case "noMerges":
        next.noMerges = false;
        break;
    }
    filters.value = next;
  }

  function clearAllFilters() {
    filters.value = emptyFilters();
  }

  async function applyFilters() {
    await load(true);
  }

  async function goToHashOrRef() {
    const q = goToInput.value.trim();
    if (!q) return;
    const hit = commits.value.find(
      (c) => c.sha.startsWith(q) || c.refs.some((r) => r.includes(q)),
    );
    if (hit) {
      await select(hit.sha);
      return;
    }
    filters.value = { ...filters.value, text: q };
    await load(true);
  }

  async function refreshIndexStatus() {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    try {
      indexStatus.value = await getBackend().logIndexStatus({ path: workspace.repoPath });
    } catch {
      indexStatus.value = null;
    }
  }

  async function rebuildIndex() {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath) return;
    indexStatus.value = await getBackend().logIndexRebuild({ path: workspace.repoPath });
  }

  function copySelectedSha() {
    const sha = selectedSha.value;
    if (!sha) return;
    void navigator.clipboard?.writeText(sha);
  }

  return {
    commits,
    loading,
    error,
    truncated,
    selectedSha,
    selectedShas,
    details,
    changedFiles,
    filters,
    showGraphOptions,
    compactRefs,
    showTagNames,
    indexStatus,
    goToInput,
    activeFilterChips,
    load,
    select,
    loadMore,
    setTextFilter,
    setAuthorFilter,
    setDatePreset,
    setPathsFilter,
    setRevisions,
    setOrder,
    toggleFirstParent,
    toggleNoMerges,
    clearFilter,
    clearAllFilters,
    applyFilters,
    goToHashOrRef,
    refreshIndexStatus,
    rebuildIndex,
    copySelectedSha,
  };
});
