import { defineStore } from "pinia";
import { computed, onScopeDispose, ref, shallowRef, watch } from "vue";
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
import { timedAsync } from "@/lib/longTaskLog";
import { sameWorkspacePath, workspacePathKey } from "@/lib/workspacePath";
import { useJobsStore } from "./jobsStore";

/**
 * Background-refresh equality without JSON.stringify of the whole page
 * (that was multi-second on large loaded windows).
 */
function sameCommitWindow(a: readonly LogCommit[], b: readonly LogCommit[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i]!;
    const right = b[i]!;
    if (
      left.sha !== right.sha ||
      left.subject !== right.subject ||
      left.authorTime !== right.authorTime ||
      left.refs.length !== right.refs.length
    )
      return false;
    for (let r = 0; r < left.refs.length; r++) {
      if (left.refs[r] !== right.refs[r]) return false;
    }
  }
  return true;
}

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
  // Huge arrays must stay shallow — deep `ref` proxies every commit on replace/append.
  const commits = shallowRef<LogCommit[]>([]);
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
  const detailsRequest = shallowRef<{ current: () => boolean } | null>(null);
  const detailsFailure = shallowRef<{ current: () => boolean; message: string } | null>(null);
  const detailsLoading = computed(() => detailsRequest.value?.current() ?? false);
  const detailsError = computed(() =>
    detailsFailure.value?.current() ? detailsFailure.value.message : null,
  );
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
  const indexRebuilds = shallowRef(new Set<string>());
  const rebuildingIndex = computed(
    () => !!workspace.repoPath && indexRebuilds.value.has(workspacePathKey(workspace.repoPath)),
  );
  let disposed = false;
  onScopeDispose(() => {
    disposed = true;
    ++indexGen;
    invalidateSelection();
    indexRebuilds.value = new Set();
  });

  function invalidateSelection() {
    ++selectGen;
    detailsRequest.value = null;
    detailsFailure.value = null;
  }

  function currentRepository() {
    const path = workspace.repoPath;
    const navigation = workspace.navigationToken();
    return () => workspace.repoPath === path && workspace.navigationToken() === navigation;
  }

  watch(
    () => workspace.repoPath,
    () => {
      ++loadGen;
      invalidateSelection();
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

  async function load(reset = true, background = false, options: { taskOwned?: boolean } = {}) {
    const label = reset ? (background ? "log.load:refresh" : "log.load:reset") : "log.loadMore";
    return timedAsync(
      label,
      () => loadInner(reset, background, options.taskOwned ?? false),
      background || !reset ? 50 : 100,
    );
  }

  async function loadInner(reset = true, background = false, taskOwned = false) {
    const isCurrentRepository = currentRepository();
    if (!workspace.repoPath || !workspace.repoId || !workspace.isRepo) {
      ++loadGen;
      invalidateSelection();
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
      if (!background) invalidateSelection();
      loading.value = !background;
      loadingMore.value = false;
      error.value = null;
    } else {
      loadingMore.value = true;
    }

    // Opening a workspace already owns the initial reads as one task. Later
    // user queries must still register independently, even during that opening.
    const jobs = background || taskOwned ? null : useJobsStore();
    const job = jobs?.begin(
      String(i18n.global.t(reset ? "log.loadingHistory" : "log.loadingMore")),
      path,
    );
    try {
      const backend = getBackend();
      let offset = reset ? 0 : nextOffset.value;
      let requestedCount = background ? Math.max(100, commits.value.length) : 100;
      const requestFilters = copyFilters(filters.value);
      let appendedStart = startOffset.value;
      const repoId = workspace.repoId;
      const readPage = (from: number, limit: number) =>
        backend.logQuery({ repoId, path, offset: from, limit, filters: requestFilters });
      const current = () => gen === loadGen && isCurrentRepository();
      let page: Awaited<ReturnType<typeof readPage>> | undefined;
      if (reset && background && commits.value[0]) {
        const first = commits.value[0].sha;
        // The first page usually contains the current top anchor, even after a push.
        // Reuse it both to verify the anchor and to display the updated commits.
        if (startOffset.value === 0) {
          page = await readPage(0, Math.min(1000, requestedCount));
          if (!current()) return;
          const index = page.commits.findIndex((commit) => commit.sha === first);
          if (index >= 0) requestedCount += index;
          else page = undefined;
        }
        if (!page) {
          const anchor = await backend.logLocate({
            path,
            revision: first,
            filters: requestFilters,
          });
          if (!current()) return;
          if (anchor.offset !== null) {
            if (startOffset.value === 0 && anchor.offset <= 1000) requestedCount += anchor.offset;
            else offset = anchor.offset;
          }
        }
      } else if (!reset && commits.value.length) {
        const tail = commits.value[commits.value.length - 1]!.sha;
        // Read the boundary and next page from one Git snapshot. Only a shifted
        // or removed boundary needs the more expensive exact history lookup.
        const overlap = await readPage(Math.max(0, offset - 1), requestedCount + 1);
        if (!current()) return;
        if (overlap.commits[0]?.sha === tail) {
          page = { ...overlap, commits: overlap.commits.slice(1) };
        } else {
          const anchor = await backend.logLocate({ path, revision: tail, filters: requestFilters });
          if (!current()) return;
          if (anchor.offset === null) throw new Error(String(i18n.global.t("log.historyChanged")));
          offset = anchor.offset + 1;
          appendedStart = Math.max(0, startOffset.value + offset - nextOffset.value);
        }
      }
      page ??= await readPage(offset, Math.min(1000, requestedCount));
      if (!current()) return;
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
        const windowChanged = !sameCommitWindow(commits.value, page.commits);
        if (windowChanged) commits.value = page.commits;
        truncated.value = page.truncated;
        nextOffset.value = page.nextOffset;
        if (!background || !page.commits.some((c) => c.sha === selectedSha.value)) {
          invalidateSelection();
          selectedSha.value = null;
          selectedShas.value = [];
          details.value = null;
          changedFiles.value = [];
        } else if (windowChanged) {
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
      if (job) jobs?.finished(job);
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

  async function select(
    sha: string,
    multi = false,
    range = false,
    selectionOrder?: readonly string[],
  ) {
    if (disposed) return;
    const gen = ++selectGen;
    if (range && selectionAnchor) {
      const order = selectionOrder ?? commits.value.map((commit) => commit.sha);
      const start = order.indexOf(selectionAnchor);
      const end = order.indexOf(sha);
      selectedShas.value =
        start >= 0 && end >= 0
          ? order.slice(Math.min(start, end), Math.max(start, end) + 1)
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
    await readSelectedDetails(gen);
  }

  async function retryDetails() {
    if (disposed || detailsLoading.value || !selectedSha.value || !workspace.isRepo) return;
    // A retry only reads the focused commit; it must not collapse a Ctrl/Shift
    // selection or move the anchor used by the next range extension.
    await readSelectedDetails(++selectGen);
  }

  async function readSelectedDetails(gen: number) {
    const path = workspace.repoPath;
    const target = selectedSha.value;
    const isCurrentRepository = currentRepository();
    details.value = null;
    changedFiles.value = [];
    detailsRequest.value = null;
    detailsFailure.value = null;
    if (disposed || !path || !target) return;
    const current = () =>
      !disposed && gen === selectGen && selectedSha.value === target && isCurrentRepository();
    const request = { current };
    detailsRequest.value = request;
    const backend = getBackend();
    const jobs = useJobsStore();
    const job = jobs.begin(
      String(i18n.global.t("log.loadingDetails", { sha: target.slice(0, 7) })),
      path,
    );
    // Keep the queue entry until both native reads settle, even when one fails
    // early and the panel can already report an actionable error.
    const reads = [
      Promise.resolve().then(() => backend.logCommitDetails({ path, sha: target })),
      Promise.resolve().then(() => backend.logChangedFiles({ path, sha: target })),
    ] as const;
    void Promise.allSettled(reads).then(() => jobs.finished(job));
    try {
      const [d, files] = await Promise.all(reads);
      if (!current()) return;
      details.value = d;
      changedFiles.value = files;
    } catch (e) {
      if (!current()) return;
      details.value = null;
      changedFiles.value = [];
      detailsFailure.value = { current, message: formatErrorMessage(e) };
      throw e;
    } finally {
      if (detailsRequest.value === request) detailsRequest.value = null;
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
    if (disposed || !revision || !path || !workspace.repoId) return;
    const gen = ++loadGen;
    locating.value = true;
    loading.value = false;
    loadingMore.value = false;
    loadingPrevious.value = false;
    navigationMiss.value = null;
    const selectionAtStart = selectGen;
    const requestFilters = copyFilters(filters.value);
    const jobs = useJobsStore();
    const job = jobs.begin(`${i18n.global.t("log.locating")} · ${revision}`, path);
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
      // Selection is synchronous; its details read has its own task and local
      // error/retry panel. Reveal the target without waiting for that read.
      void select(location.sha).catch(() => {
        // readSelectedDetails publishes only the current selection's error.
      });
      return location.sha;
    } catch (e) {
      if (gen === loadGen && isCurrentRepository() && selectionAtStart === selectGen) throw e;
    } finally {
      jobs.finished(job);
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
    // A read taken while rebuilding may still see the previous index. The
    // rebuild result owns publication until it finishes for this repository.
    if (disposed || !path || rebuildingIndex.value) return;
    const gen = ++indexGen;
    const load = loadGen;
    const isCurrentRepository = currentRepository();
    const current = () =>
      !disposed && gen === indexGen && load === loadGen && isCurrentRepository();
    try {
      const result = await getBackend().logIndexStatus({ path });
      if (current()) indexStatus.value = result;
    } catch {
      if (current()) indexStatus.value = null;
    }
  }

  async function rebuildIndex() {
    const path = workspace.repoPath;
    if (disposed || !path || !workspace.isRepo) return;
    const key = workspacePathKey(path);
    if (indexRebuilds.value.has(key)) return;
    indexRebuilds.value = new Set([...indexRebuilds.value, key]);
    const gen = ++indexGen;
    const isCurrentRepository = currentRepository();
    // The index belongs to the repository, independently of Log filters/pages.
    const current = () => !disposed && gen === indexGen && isCurrentRepository();
    try {
      const result = await getBackend().logIndexRebuild({ path });
      if (current()) indexStatus.value = result;
    } catch (e) {
      if (!current()) return;
      toast({
        title: String(i18n.global.t("log.rebuildIndex")),
        description: formatErrorMessage(e),
      });
    } finally {
      const pending = new Set(indexRebuilds.value);
      pending.delete(key);
      indexRebuilds.value = pending;
      // Switching away and back keeps the actual work deduplicated. Do not
      // publish an old navigation's result; read the current status instead.
      if (!current() && !disposed && sameWorkspacePath(workspace.repoPath, path))
        await refreshIndexStatus();
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
    detailsLoading,
    detailsError,
    filters,
    showGraphOptions,
    compactRefs,
    showTagNames,
    indexStatus,
    rebuildingIndex,
    goToInput,
    activeFilterChips,
    load,
    select,
    retryDetails,
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
