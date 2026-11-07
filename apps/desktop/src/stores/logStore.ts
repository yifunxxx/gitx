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
import { toast } from "@/composables/useToast";
import { i18n } from "@/i18n";

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
  const loadingMore = ref(false);
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

  /** Monotonic generation — supersedes in-flight loads (dedupe / cancel). */
  let loadGen = 0;

  const activeFilterChips = computed(() => {
    const t = i18n.global.t;
    const chips: { key: string; label: string }[] = [];
    if (filters.value.text)
      chips.push({ key: "text", label: String(t("log.chipText", { value: filters.value.text })) });
    if (filters.value.authors?.length)
      chips.push({
        key: "authors",
        label: String(t("log.chipUser", { value: filters.value.authors.join(", ") })),
      });
    if (filters.value.since)
      chips.push({
        key: "since",
        label: String(t("log.chipSince", { value: filters.value.since })),
      });
    if (filters.value.until)
      chips.push({
        key: "until",
        label: String(t("log.chipUntil", { value: filters.value.until })),
      });
    if (filters.value.paths?.length)
      chips.push({
        key: "paths",
        label: String(t("log.chipPaths", { value: filters.value.paths.join(", ") })),
      });
    if (filters.value.revisions?.length)
      chips.push({
        key: "revisions",
        label: String(t("log.chipBranch", { value: filters.value.revisions.join(" ") })),
      });
    if (filters.value.firstParent)
      chips.push({ key: "firstParent", label: String(t("log.firstParent")) });
    if (filters.value.noMerges) chips.push({ key: "noMerges", label: String(t("log.noMerges")) });
    return chips;
  });

  async function load(reset = true) {
    const workspace = useWorkspaceStore();
    if (!workspace.repoPath || !workspace.repoId || !workspace.isRepo) {
      commits.value = [];
      truncated.value = false;
      loading.value = false;
      loadingMore.value = false;
      return;
    }

    if (!reset && (loading.value || loadingMore.value || !truncated.value)) return;

    const gen = ++loadGen;
    if (reset) {
      loading.value = true;
      loadingMore.value = false;
      error.value = null;
    } else {
      loadingMore.value = true;
    }

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
      if (gen !== loadGen) return;

      if (reset) {
        commits.value = page.commits;
        truncated.value = page.truncated;
        nextOffset.value = page.nextOffset;
        selectedSha.value = null;
        selectedShas.value = [];
      } else {
        const seen = new Set(commits.value.map((c) => c.sha));
        const added = page.commits.filter((c) => !seen.has(c.sha));
        if (added.length === 0) {
          // Empty / duplicate page → stop infinite spinner loops.
          truncated.value = false;
        } else {
          commits.value = [...commits.value, ...added];
          truncated.value = page.truncated;
          nextOffset.value = page.nextOffset;
        }
      }

      void refreshIndexStatus();
    } catch (e) {
      if (gen !== loadGen) return;
      const msg = formatErrorMessage(e);
      if (reset) {
        error.value = msg;
      } else {
        // Keep existing rows; never leave load-more spinning forever.
        truncated.value = true;
        toast({
          title: String(i18n.global.t("log.loadMoreFailed")),
          description: msg,
        });
      }
    } finally {
      if (gen === loadGen) {
        loading.value = false;
        loadingMore.value = false;
      }
    }

    // Select after clearing loading so a hung details IPC cannot pin the spinner.
    if (gen === loadGen && reset && !selectedSha.value && commits.value[0]) {
      void select(commits.value[0].sha).catch((e) => {
        toast({
          title: String(i18n.global.t("log.failed")),
          description: formatErrorMessage(e),
        });
      });
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
    try {
      const [d, files] = await Promise.all([
        backend.logCommitDetails({ path: workspace.repoPath, sha }),
        backend.logChangedFiles({ path: workspace.repoPath, sha }),
      ]);
      if (selectedSha.value !== sha) return;
      details.value = d;
      changedFiles.value = files;
    } catch (e) {
      if (selectedSha.value !== sha) return;
      details.value = null;
      changedFiles.value = [];
      throw e;
    }
  }

  async function loadMore() {
    if (!truncated.value || loading.value || loadingMore.value) return;
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
    const hit = commits.value.find((c) => c.sha.startsWith(q) || c.refs.some((r) => r.includes(q)));
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
    try {
      indexStatus.value = await getBackend().logIndexRebuild({ path: workspace.repoPath });
    } catch (e) {
      toast({
        title: String(i18n.global.t("log.rebuildIndex")),
        description: formatErrorMessage(e),
      });
    }
  }

  function copySelectedSha() {
    const sha = selectedSha.value;
    if (!sha) return;
    void navigator.clipboard?.writeText(sha);
  }

  return {
    commits,
    loading,
    loadingMore,
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
