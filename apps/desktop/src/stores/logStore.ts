import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
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

const copyFilters = (value: LogFilters): LogFilters => ({
  ...value,
  authors: [...(value.authors ?? [])],
  revisions: [...(value.revisions ?? [])],
  paths: [...(value.paths ?? [])],
});

export const useLogStore = defineStore("log", () => {
  const commits = ref<LogCommit[]>([]);
  const loading = ref(false);
  const loadingMore = ref(false);
  const loadingPrevious = ref(false);
  const locating = ref(false);
  const startOffset = ref(0);
  const navigationMiss = ref<string | null>(null);
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
  let indexGen = 0;
  let selectGen = 0;
  let selectionAnchor: string | null = null;
  const workspace = useWorkspaceStore();

  function currentRepository() {
    const path = workspace.repoPath;
    const navigation = workspace.navigationToken();
    return () => workspace.repoPath === path && workspace.navigationToken() === navigation;
  }

  watch(
    () => workspace.repoPath,
    () => {
      ++loadGen;
      ++selectGen;
      ++indexGen;
      commits.value = [];
      details.value = null;
      changedFiles.value = [];
      selectedSha.value = null;
      selectedShas.value = [];
      selectionAnchor = null;
      nextOffset.value = 0;
      startOffset.value = 0;
      navigationMiss.value = null;
      truncated.value = false;
      loading.value = false;
      loadingMore.value = false;
      loadingPrevious.value = false;
      locating.value = false;
      error.value = null;
      indexStatus.value = null;
      filters.value = emptyFilters();
    },
    { flush: "sync" },
  );

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

  watch(
    filters,
    () => {
      ++loadGen;
      locating.value = false;
      loading.value = false;
      loadingMore.value = false;
      loadingPrevious.value = false;
      navigationMiss.value = null;
    },
    { flush: "sync", deep: true },
  );

  async function load(reset = true, background = false) {
    const isCurrentRepository = currentRepository();
    if (!workspace.repoPath || !workspace.repoId || !workspace.isRepo) {
      ++loadGen;
      ++selectGen;
      commits.value = [];
      selectedSha.value = null;
      selectedShas.value = [];
      details.value = null;
      changedFiles.value = [];
      truncated.value = false;
      loading.value = false;
      loadingMore.value = false;
      loadingPrevious.value = false;
      locating.value = false;
      startOffset.value = 0;
      nextOffset.value = 0;
      navigationMiss.value = null;
      selectionAnchor = null;
      return;
    }

    if (
      background &&
      (loading.value || locating.value || loadingPrevious.value || loadingMore.value)
    )
      return;
    if (
      !reset &&
      (loading.value ||
        loadingMore.value ||
        loadingPrevious.value ||
        locating.value ||
        !truncated.value)
    )
      return;

    const gen = ++loadGen;
    locating.value = false;
    loadingPrevious.value = false;
    navigationMiss.value = null;
    const path = workspace.repoPath;
    const previousSha = selectedSha.value;
    if (reset) {
      if (!background) ++selectGen;
      loading.value = !background;
      loadingMore.value = false;
      error.value = null;
    } else {
      loadingMore.value = true;
    }

    try {
      const backend = getBackend();
      let offset = reset ? 0 : nextOffset.value;
      let requestedCount = background ? Math.max(100, commits.value.length) : 100;
      const requestFilters = copyFilters(filters.value);
      let appendedStart = startOffset.value;
      if (reset && background && commits.value[0]) {
        const anchor = await backend.logLocate({
          path,
          revision: commits.value[0].sha,
          filters: requestFilters,
        });
        if (gen !== loadGen || !isCurrentRepository()) return;
        if (anchor.offset !== null) {
          // Include a small number of new rows without dropping the old bottom.
          // A large incoming history keeps the existing bounded window instead.
          if (startOffset.value === 0 && anchor.offset <= 1000) requestedCount += anchor.offset;
          else offset = anchor.offset;
        }
      } else if (!reset && commits.value.at(-1)) {
        const anchor = await backend.logLocate({
          path,
          revision: commits.value.at(-1)!.sha,
          filters: requestFilters,
        });
        if (gen !== loadGen || !isCurrentRepository()) return;
        if (anchor.offset === null) throw new Error(String(i18n.global.t("log.historyChanged")));
        offset = anchor.offset + 1;
        appendedStart = Math.max(0, startOffset.value + offset - nextOffset.value);
      }
      const page = await backend.logQuery({
        repoId: workspace.repoId,
        path,
        offset,
        limit: Math.min(1000, requestedCount),
        filters: requestFilters,
      });
      if (gen !== loadGen || !isCurrentRepository()) return;
      // The backend caps each page at 1000. Preserve an already scrolled
      // history during refresh instead of silently dropping its later pages.
      while (reset && background && page.truncated && page.commits.length < requestedCount) {
        const next = await backend.logQuery({
          repoId: workspace.repoId!,
          path,
          offset: page.nextOffset,
          limit: Math.min(1000, requestedCount - page.commits.length),
          filters: requestFilters,
        });
        if (gen !== loadGen || !isCurrentRepository()) return;
        if (!next.commits.length || next.nextOffset <= page.nextOffset)
          throw new Error(String(i18n.global.t("log.historyChanged")));
        page.commits.push(...next.commits);
        page.nextOffset = next.nextOffset;
        page.truncated = next.truncated;
      }

      if (reset) {
        startOffset.value = offset;
        if (JSON.stringify(commits.value) !== JSON.stringify(page.commits))
          commits.value = page.commits;
        truncated.value = page.truncated;
        nextOffset.value = page.nextOffset;
        if (!background || !page.commits.some((c) => c.sha === selectedSha.value)) {
          ++selectGen;
          selectedSha.value = null;
          selectedShas.value = [];
          details.value = null;
          changedFiles.value = [];
        } else {
          const known = new Set(page.commits.map((c) => c.sha));
          selectedShas.value = selectedShas.value.filter((sha) => known.has(sha));
        }
      } else {
        const seen = new Set(commits.value.map((c) => c.sha));
        const added = page.commits.filter((c) => !seen.has(c.sha));
        if (added.length === 0) {
          // Empty / duplicate page → stop infinite spinner loops.
          truncated.value = false;
        } else {
          commits.value = [...commits.value, ...added];
          startOffset.value = appendedStart;
          truncated.value = page.truncated;
          nextOffset.value = page.nextOffset;
        }
      }

      void refreshIndexStatus();
    } catch (e) {
      if (gen !== loadGen || !isCurrentRepository()) return;
      const msg = formatErrorMessage(e);
      if (reset && (!background || !commits.value.length)) {
        error.value = msg;
      } else {
        // Keep existing rows; never leave load-more spinning forever.
        toast({
          title: String(i18n.global.t(background ? "log.refreshFailed" : "log.loadMoreFailed")),
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
    if (
      gen === loadGen &&
      isCurrentRepository() &&
      reset &&
      !selectedSha.value &&
      commits.value[0]
    ) {
      const target = commits.value.find((c) => c.sha === previousSha) ?? commits.value[0];
      void select(target.sha).catch((e) => {
        toast({
          title: String(i18n.global.t("log.failed")),
          description: formatErrorMessage(e),
        });
      });
    }
  }

  async function select(sha: string, multi = false, range = false) {
    const isCurrentRepository = currentRepository();
    const gen = ++selectGen;
    if (range && selectionAnchor) {
      const start = commits.value.findIndex((c) => c.sha === selectionAnchor);
      const end = commits.value.findIndex((c) => c.sha === sha);
      selectedShas.value =
        start >= 0 && end >= 0
          ? commits.value.slice(Math.min(start, end), Math.max(start, end) + 1).map((c) => c.sha)
          : [sha];
      selectedSha.value = sha;
    } else if (multi) {
      if (selectedShas.value.includes(sha)) {
        selectedShas.value = selectedShas.value.filter((s) => s !== sha);
      } else {
        selectedShas.value = [...selectedShas.value, sha];
      }
      selectedSha.value = selectedShas.value.includes(sha)
        ? sha
        : (selectedShas.value.at(-1) ?? null);
      selectionAnchor = selectedSha.value;
    } else {
      selectedSha.value = sha;
      selectedShas.value = [sha];
      selectionAnchor = sha;
    }
    const path = workspace.repoPath;
    const target = selectedSha.value;
    details.value = null;
    changedFiles.value = [];
    if (!path || !target) return;
    const backend = getBackend();
    try {
      const [d, files] = await Promise.all([
        backend.logCommitDetails({ path, sha: target }),
        backend.logChangedFiles({ path, sha: target }),
      ]);
      if (gen !== selectGen || !isCurrentRepository()) return;
      details.value = d;
      changedFiles.value = files;
    } catch (e) {
      if (gen !== selectGen || !isCurrentRepository()) return;
      details.value = null;
      changedFiles.value = [];
      throw e;
    }
  }

  async function loadMore() {
    if (!truncated.value || loading.value || loadingMore.value) return;
    await load(false);
  }

  async function loadPrevious() {
    const isCurrentRepository = currentRepository();
    const path = workspace.repoPath;
    if (
      !path ||
      !workspace.repoId ||
      !startOffset.value ||
      loading.value ||
      loadingMore.value ||
      loadingPrevious.value ||
      locating.value
    )
      return;
    const gen = ++loadGen;
    loadingPrevious.value = true;
    try {
      const backend = getBackend();
      const requestFilters = copyFilters(filters.value);
      const anchor = await backend.logLocate({
        path,
        revision: commits.value[0]!.sha,
        filters: requestFilters,
      });
      if (gen !== loadGen || !isCurrentRepository()) return;
      if (anchor.offset === null) throw new Error(String(i18n.global.t("log.historyChanged")));
      const offset = Math.max(0, anchor.offset - 100);
      const page =
        anchor.offset === 0
          ? { commits: [] }
          : await backend.logQuery({
              repoId: workspace.repoId,
              path,
              offset,
              limit: anchor.offset - offset,
              filters: requestFilters,
            });
      if (gen !== loadGen || !isCurrentRepository()) return;
      const known = new Set(commits.value.map((c) => c.sha));
      commits.value = [...page.commits.filter((c) => !known.has(c.sha)), ...commits.value];
      nextOffset.value += anchor.offset - startOffset.value;
      startOffset.value = offset;
    } catch (e) {
      if (gen === loadGen && isCurrentRepository())
        toast({
          title: String(i18n.global.t("log.loadMoreFailed")),
          description: formatErrorMessage(e),
        });
    } finally {
      if (gen === loadGen) loadingPrevious.value = false;
    }
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

  async function goToHashOrRef(revision = goToInput.value.trim()) {
    const isCurrentRepository = currentRepository();
    const path = workspace.repoPath;
    if (!revision || !path || !workspace.repoId) return;
    const gen = ++loadGen;
    locating.value = true;
    loading.value = false;
    loadingMore.value = false;
    loadingPrevious.value = false;
    navigationMiss.value = null;
    const selectionAtStart = selectGen;
    const requestFilters = copyFilters(filters.value);
    let applyingSelection = false;
    try {
      const backend = getBackend();
      const location = await backend.logLocate({ path, revision, filters: requestFilters });
      if (gen !== loadGen || !isCurrentRepository() || selectionAtStart !== selectGen) return;
      if (location.offset === null) {
        navigationMiss.value = location.sha;
        return;
      }
      if (!commits.value.some((c) => c.sha === location.sha)) {
        // Open a bounded window around the target. Loading every preceding page
        // would make a jump near the root of a large repository unresponsive.
        const offset = Math.max(0, location.offset - 50);
        const page = await backend.logQuery({
          repoId: workspace.repoId!,
          path,
          offset,
          limit: 150,
          filters: requestFilters,
        });
        if (gen !== loadGen || !isCurrentRepository() || selectionAtStart !== selectGen) return;
        if (!page.commits.some((c) => c.sha === location.sha)) {
          throw new Error(String(i18n.global.t("log.historyChanged")));
        }
        commits.value = page.commits;
        startOffset.value = offset;
        nextOffset.value = page.nextOffset;
        truncated.value = page.truncated;
      }
      error.value = null;
      applyingSelection = true;
      await select(location.sha);
      if (gen === loadGen && isCurrentRepository() && selectedSha.value === location.sha)
        return location.sha;
    } catch (e) {
      if (
        gen === loadGen &&
        isCurrentRepository() &&
        (applyingSelection || selectionAtStart === selectGen)
      )
        throw e;
    } finally {
      if (gen === loadGen) locating.value = false;
    }
  }

  async function revealNavigationTarget() {
    const sha = navigationMiss.value;
    if (!sha) return;
    clearAllFilters();
    return await goToHashOrRef(sha);
  }

  async function refreshIndexStatus() {
    const path = workspace.repoPath;
    if (!path) return;
    const gen = ++indexGen;
    const load = loadGen;
    const isCurrentRepository = currentRepository();
    const current = () => gen === indexGen && load === loadGen && isCurrentRepository();
    try {
      const result = await getBackend().logIndexStatus({ path });
      if (current()) indexStatus.value = result;
    } catch {
      if (current()) indexStatus.value = null;
    }
  }

  async function rebuildIndex() {
    const path = workspace.repoPath;
    if (!path) return;
    const gen = ++indexGen;
    const load = loadGen;
    const isCurrentRepository = currentRepository();
    const current = () => gen === indexGen && load === loadGen && isCurrentRepository();
    try {
      const result = await getBackend().logIndexRebuild({ path });
      if (current()) indexStatus.value = result;
    } catch (e) {
      if (!current()) return;
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
    loadingPrevious,
    locating,
    startOffset,
    navigationMiss,
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
    loadPrevious,
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
    revealNavigationTarget,
    refreshIndexStatus,
    rebuildIndex,
    copySelectedSha,
  };
});
