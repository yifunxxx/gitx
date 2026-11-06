import type { Backend } from "./index";
import type {
  AppSettings,
  ChangelistsState,
  CommitDetails,
  DiffFileResult,
  DiffHunk,
  FileChange,
  JobHandle,
  LogCommit,
  ShelfEntry,
  StashEntry,
  StatusSnapshot,
} from "./bindings";

const defaultSettings: AppSettings = {
  schemaVersion: 3,
  appearance: {
    theme: "system",
    palette: "pearl",
    cornerStyle: "small",
  },
  locale: "en",
  gitExecutable: null,
  recentWorkspaces: ["/tmp/demo-repo"],
  stagingMode: false,
  showIgnoredFiles: false,
  logIndexing: true,
  git: {
    updateMethod: "merge",
    fetchTags: "auto",
    autoFetchMinutes: 0,
    checkIncoming: "auto",
    showUpdateInfo: true,
    showOptionsBeforeUpdate: true,
    fetchOnAddRemote: true,
    protectedBranches: ["main", "master"],
    useCredentialHelper: true,
    groupBranchesByDirectory: true,
    showRecentBranches: true,
    showTags: true,
    cherryPickSuffixProtected: true,
    cleanTreeMethod: "stash",
    combineStashesAndShelves: true,
    allowPerHunkChangelists: true,
    executeBranchOpsOnAllRoots: true,
    updateSubmodules: "auto",
    forkParentRemote: "upstream",
    commitTwMode: "docked",
    commitControlsHidden: false,
    closeCommitTwAfterCommit: false,
  },
};

let settings = structuredClone(defaultSettings);
let amendMessage = "Initial commit\n";
let nextSha = 2;

const files: FileChange[] = [
  {
    path: "README.md",
    origPath: null,
    indexStatus: ".",
    worktreeStatus: "M",
    kind: "modified",
  },
  {
    path: "src/app.ts",
    origPath: null,
    indexStatus: "A",
    worktreeStatus: ".",
    kind: "added",
  },
  {
    path: "notes.txt",
    origPath: null,
    indexStatus: "?",
    worktreeStatus: "?",
    kind: "untracked",
  },
  {
    path: "build/tmp.o",
    origPath: null,
    indexStatus: "!",
    worktreeStatus: "!",
    kind: "ignored",
  },
];

function emitConsole(stream: string, line: string) {
  window.dispatchEvent(new CustomEvent("console://line", { detail: { stream, line } }));
}

function mockHunks(): DiffHunk[] {
  return [
    {
      index: 0,
      header: "@@ -1,3 +1,3 @@",
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 3,
      lines: [" # gitx", "-hello", "+hello world", " "],
    },
  ];
}

function mockLog(): LogCommit[] {
  return [
    {
      sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      shortSha: "aaaaaaa",
      parents: ["bbbbbbbccccccccccccccccccccccccccccccc"],
      subject: "Add staging Changes UI",
      author: "gitx",
      authorEmail: "gitx@local",
      authorTime: 1_704_067_200,
      refs: ["HEAD -> main"],
      graph: { lane: 0, edges: [{ fromLane: 0, toLane: 0 }], color: 0 },
    },
    {
      sha: "bbbbbbbccccccccccccccccccccccccccccccc",
      shortSha: "bbbbbbb",
      parents: [],
      subject: "Initial commit",
      author: "gitx",
      authorEmail: "gitx@local",
      authorTime: 1_704_000_000,
      refs: ["tag: v0.1"],
      graph: { lane: 0, edges: [], color: 0 },
    },
  ];
}


let mockBranch = "main";
let mockBranches = ["main", "develop"];
let mockRemotes: { name: string; fetchUrl: string; pushUrl: string | null }[] = [
  { name: "origin", fetchUrl: "https://example.com/gitx.git", pushUrl: null },
];
let mockFavorites: string[] = ["refs/heads/main"];
let mockTags: { name: string; sha: string }[] = [{ name: "v0.1", sha: "bbbbbbbccccccccccccccccccccccccccccccc" }];
let mockAhead = 1;
let hasFetched = false;
let mockBehind = 0;
let mockChangelists: ChangelistsState = {
  lists: [
    { id: "default", name: "Changes", comment: "", active: true },
  ],
  assignments: [],
};
let mockStashes: StashEntry[] = [
  {
    index: 0,
    sha: "ccccccccddddddddeeeeeeeeffffffffaaaaaaa",
    message: "WIP on main: stash demo",
    branch: "main",
    time: 1_704_100_000,
  },
];
let mockShelves: ShelfEntry[] = [
  {
    id: "shelf-1",
    message: "Shelved notes",
    createdAt: 1_704_100_000,
    baseSha: "bbbbbbbccccccccccccccccccccccccccccccc",
    paths: ["notes.txt"],
    sourceChangelist: null,
    binary: false,
    system: false,
  },
];
let nextShelfId = 2;

function statusSnapshot(path: string, includeIgnored = false): StatusSnapshot {
  const list = includeIgnored
    ? files
    : files.filter((f) => f.kind !== "ignored" && f.indexStatus !== "!");
  return {
    repoId: path,
    version: Date.now(),
    branch: {
      head: mockBranch,
      upstream: mockRemotes.length ? `origin/${mockBranch}` : null,
      ahead: mockAhead,
      behind: mockBehind,
      detached: false,
    },
    files: structuredClone(list),
  };
}

export const mockBackend: Backend = {
  async appInfo() {
    return { name: "gitx", version: "0.1.0-web" };
  },
  async gitDetect() {
    return {
      path: "/usr/bin/git",
      version: "git version 2.43.0 (mock)",
      major: 2,
      minor: 43,
      patch: 0,
      supported: true,
    };
  },
  async gitTestExecutable(path: string) {
    return {
      path,
      version: "git version 2.43.0 (mock)",
      major: 2,
      minor: 43,
      patch: 0,
      supported: true,
    };
  },
  async settingsGet() {
    return structuredClone(settings);
  },
  async settingsSet(next) {
    settings = structuredClone(next);
    return structuredClone(settings);
  },
  async jobList() {
    return [];
  },
  async jobCancel() {
    return true;
  },
  async workspaceOpen(req) {
    settings.recentWorkspaces = [
      req.path,
      ...settings.recentWorkspaces.filter((p) => p !== req.path),
    ].slice(0, 20);
    return {
      path: req.path,
      isRepo: true,
      gitDir: `${req.path}/.git`,
      commonDir: `${req.path}/.git`,
      toplevel: req.path,
      isWorktree: false,
      wsl: null,
      roots: [
        {
          id: req.path,
          worktreeRoot: req.path,
          gitDir: `${req.path}/.git`,
          commonDir: `${req.path}/.git`,
          isWorktree: false,
          displayName: req.path.split(/[/\\]/).pop() ?? "repo",
          color: "#3b82f6",
          isSubmodule: false,
        },
      ],
    };
  },
  async workspaceRecent() {
    return { paths: [...settings.recentWorkspaces] };
  },
  async statusProbe(req): Promise<JobHandle> {
    const jobId = crypto.randomUUID();
    emitConsole(
      "cmd",
      `git --no-optional-locks status --porcelain=v2 -z --branch  # mock @ ${req.path}`,
    );
    emitConsole("stdout", "# branch.head main");
    emitConsole("stdout", "1 .M N... 100644 100644 100644 … README.md");
    window.dispatchEvent(new CustomEvent("job://finished", { detail: { id: jobId, ok: true } }));
    return { jobId };
  },
  async initRun(req) {
    emitConsole("cmd", `git init -b ${req.initialBranch ?? "main"}`);
    return this.workspaceOpen({ path: req.path });
  },
  async vcsEnable(req) {
    return this.initRun(req);
  },
  async statusGet(req) {
    emitConsole("cmd", `git status --porcelain=v2 # ${req.path}`);
    return statusSnapshot(req.path, !!req.includeIgnored);
  },
  async stagePaths(req) {
    emitConsole("cmd", `git add -A -- ${req.paths.join(" ")}`);
    for (const p of req.paths) {
      const f = files.find((x) => x.path === p);
      if (!f) continue;
      if (f.kind === "untracked") {
        f.kind = "added";
        f.indexStatus = "A";
        f.worktreeStatus = ".";
      } else {
        f.indexStatus = f.worktreeStatus === "M" ? "M" : f.indexStatus;
        f.worktreeStatus = ".";
      }
    }
    return null;
  },
  async unstagePaths(req) {
    emitConsole("cmd", `git restore --staged -- ${req.paths.join(" ")}`);
    for (const p of req.paths) {
      const f = files.find((x) => x.path === p);
      if (!f) continue;
      if (f.indexStatus === "A") {
        f.kind = "untracked";
        f.indexStatus = "?";
        f.worktreeStatus = "?";
      } else {
        f.worktreeStatus = f.indexStatus === "." ? f.worktreeStatus : f.indexStatus;
        f.indexStatus = ".";
        f.kind = "modified";
      }
    }
    return null;
  },
  async addPaths(req) {
    return this.stagePaths(req);
  },
  async stageHunks(req) {
    emitConsole("cmd", `# stage hunks ${req.hunkIndexes.join(",")} on ${req.filePath}`);
    return this.stagePaths({
      repoId: req.repoId,
      path: req.path,
      paths: [req.filePath],
    });
  },
  async unstageHunks(req) {
    emitConsole("cmd", `# unstage hunks ${req.hunkIndexes.join(",")} on ${req.filePath}`);
    return this.unstagePaths({
      repoId: req.repoId,
      path: req.path,
      paths: [req.filePath],
    });
  },
  async diffFile(req): Promise<DiffFileResult> {
    return {
      path: req.filePath,
      leftLabel: req.left === "index" ? "Staged" : req.left === "head" ? "HEAD" : "Local",
      rightLabel: req.right === "worktree" ? "Local" : req.right === "index" ? "Staged" : "HEAD",
      leftText: "# gitx\nhello\n",
      rightText: "# gitx\nhello world\n",
      binary: false,
      tooLarge: false,
      hunks: mockHunks(),
      encoding: "utf-8",
    };
  },
  async commitCreate(req) {
    if (!req.message.trim()) {
      throw { code: "emptyCommitMessage", message: "commit message is empty" };
    }
    const sha = `${nextSha.toString(16).padStart(40, "a")}`;
    nextSha += 1;
    emitConsole("cmd", `git commit ${req.amend ? "--amend " : ""}${req.noVerify ? "--no-verify " : ""}-F <msg>`);
    emitConsole("stdout", `[main ${sha.slice(0, 7)}] ${req.message.trim().split("\n")[0]}`);
    if (req.amend) amendMessage = req.message;
    // Clear staged mock files
    for (const f of [...files]) {
      if (f.indexStatus !== "." && f.indexStatus !== "?") {
        const i = files.indexOf(f);
        if (i >= 0) files.splice(i, 1);
      }
    }
    return { sha, subject: req.message.trim().split("\n")[0] ?? "", amended: !!req.amend };
  },
  async commitHeadMessage() {
    return amendMessage;
  },
  async logQuery(req) {
    let all = mockLog();
    const f = req.filters;
    if (f?.text) {
      const q = f.text.toLowerCase();
      all = all.filter(
        (c) => c.subject.toLowerCase().includes(q) || c.sha.toLowerCase().startsWith(q),
      );
    }
    if (f?.authors?.length) {
      all = all.filter((c) =>
        f.authors!.some((a) => c.author.toLowerCase().includes(a.toLowerCase())),
      );
    }
    if (f?.noMerges) {
      all = all.filter((c) => c.parents.length <= 1);
    }
    const offset = req.offset ?? 0;
    const limit = req.limit ?? 100;
    const slice = all.slice(offset, offset + limit);
    return {
      commits: slice,
      truncated: offset + limit < all.length,
      nextOffset: offset + slice.length,
    };
  },
  async logCommitDetails(req): Promise<CommitDetails> {
    const c = mockLog().find((x) => x.sha === req.sha) ?? mockLog()[0]!;
    return {
      sha: c.sha,
      parents: c.parents,
      author: c.author,
      authorEmail: c.authorEmail,
      authorTime: c.authorTime,
      committer: c.author,
      committerEmail: c.authorEmail,
      committerTime: c.authorTime,
      subject: c.subject,
      body: "",
      refs: c.refs,
    };
  },
  async logChangedFiles() {
    return [
      { path: "README.md", status: "M", origPath: null },
      { path: "src/app.ts", status: "A", origPath: null },
    ];
  },
  async fileHistory(req) {
    const all = mockLog().map((c) => ({
      sha: c.sha,
      shortSha: c.shortSha,
      parents: c.parents,
      subject: c.subject,
      author: c.author,
      authorEmail: c.authorEmail,
      authorTime: c.authorTime,
      pathAtCommit: req.filePath,
      status: "M",
      origPath: null as string | null,
    }));
    const offset = req.offset ?? 0;
    const limit = req.limit ?? 100;
    const slice = all.slice(offset, offset + limit);
    return {
      commits: slice,
      truncated: offset + limit < all.length,
      nextOffset: offset + slice.length,
    };
  },
  async blameFile(req) {
    return {
      path: req.filePath,
      rev: req.rev || "HEAD",
      lines: [
        {
          line: 1,
          sha: mockLog()[1]!.sha,
          author: "gitx",
          authorTime: 1_704_000_000,
          summary: "Initial commit",
          originalPath: req.filePath,
          notCommitted: false,
        },
        {
          line: 2,
          sha: mockLog()[0]!.sha,
          author: "gitx",
          authorTime: 1_704_067_200,
          summary: "Add staging Changes UI",
          originalPath: req.filePath,
          notCommitted: false,
        },
      ],
    };
  },
  async treeList(req) {
    if (req.dir && req.dir !== "" && req.dir !== "/") {
      return [
        {
          name: "app.ts",
          path: `${req.dir.replace(/\/$/, "")}/app.ts`,
          kind: "blob",
          mode: "100644",
          size: 42,
          sha: "deadbeef",
        },
      ];
    }
    return [
      {
        name: "README.md",
        path: "README.md",
        kind: "blob",
        mode: "100644",
        size: 12,
        sha: "abcd1234",
      },
      {
        name: "src",
        path: "src",
        kind: "tree",
        mode: "040000",
        size: null,
        sha: "tree0001",
      },
    ];
  },
  async blobRead(req) {
    return {
      path: req.filePath,
      rev: req.rev,
      text: `# ${req.filePath}\ncontent at ${req.rev}\n`,
      binary: false,
      tooLarge: false,
      size: 32,
    };
  },
  async checkoutPathFromRev(req) {
    emitConsole("cmd", `git checkout ${req.rev} -- ${req.filePath}`);
    return null;
  },
  async listRefs() {
    return ["main", "feature", "v0.1", "origin/main"];
  },
  async logIndexStatus() {
    return {
      enabled: true,
      ready: true,
      progress: 1,
      commitCount: 2,
      message: "Indexed 2 commits (mock)",
    };
  },
  async logIndexRebuild() {
    return this.logIndexStatus({ path: "/tmp/demo-repo" });
  },
  async diffFileAt(req) {
    return {
      path: req.filePath,
      leftLabel: req.leftRev.slice(0, 7),
      rightLabel: req.rightRev.slice(0, 7),
      leftText: "# gitx\nhello\n",
      rightText: "# gitx\nhello world\n",
      binary: false,
      tooLarge: false,
      hunks: mockHunks(),
      encoding: "utf-8",
    };
  },
  async diffRefs(req) {
    return {
      left: req.left,
      right: req.right,
      files: [
        { path: "README.md", status: "M", origPath: null },
        { path: "src/app.ts", status: "A", origPath: null },
      ],
    };
  },
  async diffCombined(req) {
    return {
      left: req.left,
      right: req.right ?? `${req.left}^`,
      files: [
        {
          path: "README.md",
          status: "M",
          origPath: null,
          hunks: mockHunks(),
          binary: false,
        },
      ],
    };
  },
  async refsList() {
    return {
      local: mockBranches.map((name) => ({
        name,
        fullName: `refs/heads/${name}`,
        kind: "localBranch" as const,
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        upstream: name === mockBranch && mockRemotes.length ? `origin/${name}` : null,
        ahead: name === mockBranch ? mockAhead : null,
        behind: name === mockBranch ? mockBehind : null,
        isHead: name === mockBranch,
        subject: "mock commit",
        committerTime: 1_704_067_200,
        peeledSha: null,
        isFavorite: mockFavorites.includes(`refs/heads/${name}`),
      })),
      remote: mockRemotes.flatMap((r) =>
        mockBranches.map((name) => ({
          name: `${r.name}/${name}`,
          fullName: `refs/remotes/${r.name}/${name}`,
          kind: "remoteBranch" as const,
          sha: "bbbbbbbccccccccccccccccccccccccccccccc",
          upstream: null,
          ahead: null,
          behind: null,
          isHead: false,
          subject: "remote tip",
          committerTime: 1_704_000_000,
          peeledSha: null,
          isFavorite: mockFavorites.includes(`refs/remotes/${r.name}/${name}`),
        })),
      ),
      tags: mockTags.map((t) => ({
        name: t.name,
        fullName: `refs/tags/${t.name}`,
        kind: "tag" as const,
        sha: t.sha,
        upstream: null,
        ahead: null,
        behind: null,
        isHead: false,
        subject: "tag",
        committerTime: 1_704_000_000,
        peeledSha: t.sha,
        isFavorite: false,
      })),
      recent: mockBranches.slice(0, 3),
      current: mockBranch,
      detached: false,
    };
  },
  async favoritesSet(req) {
    mockFavorites = [...req.favorites];
    return null;
  },
  async branchCreate(req) {
    if (!mockBranches.includes(req.name)) mockBranches.push(req.name);
    if (req.checkout) mockBranch = req.name;
    emitConsole("cmd", `git branch ${req.name}`);
    return null;
  },
  async branchCheckout(req) {
    mockBranch = req.target.includes("/") ? req.target.split("/").pop()! : req.target;
    if (!mockBranches.includes(mockBranch) && req.mode === "remote") mockBranches.push(mockBranch);
    emitConsole("cmd", `git checkout ${req.target}`);
    return null;
  },
  async branchRename(req) {
    mockBranches = mockBranches.map((b) => (b === req.oldName ? req.newName : b));
    if (mockBranch === req.oldName) mockBranch = req.newName;
    return null;
  },
  async branchDelete(req) {
    mockBranches = mockBranches.filter((b) => b !== req.name);
    return { sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
  },
  async branchRestore(req) {
    if (!mockBranches.includes(req.name)) mockBranches.push(req.name);
    return null;
  },
  async branchUpdate() {
    mockBehind = 0;
    return null;
  },
  async compareBranches(req) {
    return {
      left: req.left,
      right: req.right,
      leftOnly: req.left === req.right ? [] : ["aaaaaaa Add feature"],
      rightOnly: req.left === req.right ? [] : ["bbbbbbb Initial commit"],
    };
  },
  async tagCreate(req) {
    mockTags.push({ name: req.name, sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    return null;
  },
  async tagDelete(req) {
    mockTags = mockTags.filter((t) => t.name !== req.name);
    return { sha: "bbbbbbbccccccccccccccccccccccccccccccc" };
  },
  async tagPush(req) {
    emitConsole("cmd", `git push ${req.remote} refs/tags/${req.name}`);
    return null;
  },
  async remoteList() {
    return structuredClone(mockRemotes);
  },
  async remoteAdd(req) {
    mockRemotes.push({ name: req.name, fetchUrl: req.url, pushUrl: null });
    emitConsole("cmd", `git remote add ${req.name} ${req.url}`);
    return null;
  },
  async remoteEdit(req) {
    const r = mockRemotes.find((x) => x.name === req.name);
    if (!r) return null;
    if (req.newName) r.name = req.newName;
    if (req.url) r.fetchUrl = req.url;
    if (req.pushUrl) r.pushUrl = req.pushUrl;
    return null;
  },
  async remoteRemovePreview() {
    return { trackingCount: mockBranches.length };
  },
  async remoteRemove(req) {
    mockRemotes = mockRemotes.filter((r) => r.name !== req.name);
    return null;
  },
  async fetchRun() {
    mockBehind = 0;
    hasFetched = true;
    emitConsole("cmd", "git fetch --all --prune");
    return {
      remote: "all",
      newBranches: 0,
      updatedBranches: 0,
      newTags: 0,
      pruned: 0,
      message: "Everything is up to date",
    };
  },
  async pullRun() {
    mockBehind = 0;
    return {
      oldHead: "bbbbbbbccccccccccccccccccccccccccccccc",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      strategy: "merge",
      updated: true,
      message: "Pulled successfully",
    };
  },
  async updateProjectRun(req) {
    mockBehind = 0;
    return {
      oldHead: "bbbbbbbccccccccccccccccccccccccccccccc",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      strategy: req.strategy,
      updatedFiles: [{ path: "README.md", status: "M", origPath: null }],
      commits: ["aaaaaaa Update README"],
      message: "1 files updated in 1 commits",
    };
  },
  async pushPreview() {
    return {
      remote: mockRemotes[0]?.name ?? "origin",
      refs: [{ local: mockBranch, remote: mockRemotes[0]?.name ?? "origin", remoteBranch: mockBranch }],
      commits: mockAhead ? ["aaaaaaa Local commit"] : [],
      setUpstream: false,
      hasRemote: mockRemotes.length > 0,
    };
  },
  async pushRun(req) {
    if (req.forceWithLease && ["main", "master"].includes(req.branch)) {
      throw { code: "protectedBranch", message: `force push to protected branch '${req.branch}' is not allowed` };
    }
    mockAhead = 0;
    emitConsole("cmd", `git push ${req.remote} ${req.branch}`);
    return {
      outcome: "success" as const,
      remote: req.remote,
      message: `Pushed to ${req.remote}/${req.branch}`,
      rejected: false,
      setUpstream: req.setUpstream,
    };
  },
  async lsRemoteCheck() {
    return { hasUnfetched: mockBehind > 0 && !hasFetched, remotes: mockBehind ? ["origin"] : [] };
  },
  async cloneCheckUrl(req) {
    return req.url.includes("git") || req.url.startsWith("http");
  },
  async cloneRun(req) {
    emitConsole("cmd", `git clone ${req.url} ${req.dir}`);
    return { path: req.dir, shallow: !!req.depth };
  },
  async unshallowRun() {
    return null;
  },
  async repoStateGet() {
    return { isShallow: false };
  },
  async repoOpStateGet() {
    return {
      kind: "normal" as const,
      phase: "normal" as const,
      step: null,
      total: null,
      conflictCount: 0,
      yoursLabel: "Yours",
      theirsLabel: "Theirs",
      summary: "",
      headBranch: "main",
      subject: null,
    };
  },
  async mergeRun(req) {
    emitConsole("cmd", `git merge ${req.branches.join(" ")}`);
    return {
      oldHead: "bbbbbbbccccccccccccccccccccccccccccccc",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: `Merged ${req.branches.join(", ")} into main`,
      conflictFiles: [],
      backupRef: null,
    };
  },
  async mergeAbort() {
    return {
      oldHead: "",
      newHead: "",
      outcome: "success" as const,
      message: "Merge aborted",
      conflictFiles: [],
      backupRef: null,
    };
  },
  async mergeCommit() {
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: "Merge committed",
      conflictFiles: [],
      backupRef: null,
    };
  },
  async rebaseRun(req) {
    emitConsole("cmd", `git rebase ${req.upstream}`);
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: `Rebased onto ${req.upstream}`,
      conflictFiles: [],
      backupRef: null,
    };
  },
  async rebaseContinue() {
    return {
      oldHead: "",
      newHead: "",
      outcome: "success" as const,
      message: "rebase --continue",
      conflictFiles: [],
      backupRef: null,
    };
  },
  async rebaseSkip() {
    return {
      oldHead: "",
      newHead: "",
      outcome: "success" as const,
      message: "rebase --skip",
      conflictFiles: [],
      backupRef: null,
    };
  },
  async rebaseAbort() {
    return {
      oldHead: "",
      newHead: "",
      outcome: "success" as const,
      message: "rebase --abort",
      conflictFiles: [],
      backupRef: null,
    };
  },
  async cherryPickRun(req) {
    emitConsole("cmd", `git cherry-pick ${req.shas.join(" ")}`);
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: `Cherry-picked ${req.shas.length} commit(s)`,
      conflictFiles: [],
      backupRef: null,
    };
  },
  async cherryPickContinue() {
    return {
      oldHead: "",
      newHead: "",
      outcome: "success" as const,
      message: "cherry-pick --continue",
      conflictFiles: [],
      backupRef: null,
    };
  },
  async cherryPickSkip() {
    return {
      oldHead: "",
      newHead: "",
      outcome: "success" as const,
      message: "cherry-pick --skip",
      conflictFiles: [],
      backupRef: null,
    };
  },
  async cherryPickAbort() {
    return {
      oldHead: "",
      newHead: "",
      outcome: "success" as const,
      message: "cherry-pick --abort",
      conflictFiles: [],
      backupRef: null,
    };
  },
  async conflictsList() {
    return { entries: [], yoursLabel: "Yours", theirsLabel: "Theirs", title: "Conflicts" };
  },
  async conflictAcceptSide() {
    return null;
  },
  async conflictVersions(req) {
    return {
      path: req.filePath,
      base: "base\n",
      ours: "ours\n",
      theirs: "theirs\n",
      isBinary: false,
    };
  },
  async conflictMerge3() {
    return {
      blocks: [
        {
          kind: "conflict" as const,
          baseLines: ["base"],
          oursLines: ["ours"],
          theirsLines: ["theirs"],
          resultLines: [],
          isSimple: false,
        },
      ],
      conflictCount: 1,
    };
  },
  async conflictSaveResult() {
    return null;
  },
  async conflictMarkResolved() {
    return null;
  },
  async conflictResolveSimple() {
    return 0;
  },
  async rebaseInteractivePlan() {
    return {
      base: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      onto: null,
      items: [
        {
          action: "pick" as const,
          sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          subject: "mock commit",
          message: null,
          author: "mock",
          authorTime: 0,
        },
      ],
      rebaseMerges: false,
      autosquash: false,
    };
  },
  async rebaseInteractiveStart() {
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: "Rebase finished",
      conflictFiles: [],
      backupRef: "refs/gitx/backup/rebase-interactive-0",
    };
  },
  async rewordCommit() {
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: "Reworded commit",
      conflictFiles: [],
      backupRef: "refs/gitx/backup/reword-0",
    };
  },
  async squashCommits() {
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: "Squashed commits",
      conflictFiles: [],
      backupRef: "refs/gitx/backup/squash-0",
    };
  },
  async dropCommits(req) {
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: `Dropped ${req.shas.length} commit(s)`,
      conflictFiles: [],
      backupRef: "refs/gitx/backup/drop-0",
    };
  },
  async fixupInto(req) {
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: req.squash ? "Squashed into commit" : "Fixed up into commit",
      conflictFiles: [],
      backupRef: "refs/gitx/backup/fixup-0",
    };
  },
  async uncommit() {
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: "Undid commit — changes kept staged",
      conflictFiles: [],
      backupRef: "refs/gitx/backup/uncommit-0",
    };
  },
  async revertRun(req) {
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: `Reverted ${req.shas.length} commit(s)`,
      conflictFiles: [],
      backupRef: "refs/gitx/backup/revert-0",
    };
  },
  async revertContinue() {
    return {
      oldHead: "",
      newHead: "",
      outcome: "success" as const,
      message: "revert --continue",
      conflictFiles: [],
      backupRef: null,
    };
  },
  async revertAbort() {
    return {
      oldHead: "",
      newHead: "",
      outcome: "success" as const,
      message: "revert --abort",
      conflictFiles: [],
      backupRef: null,
    };
  },
  async resetPreview(req) {
    return {
      target: req.target,
      commitsAffected: 1,
      dirtyTracked: [],
      willDiscardLocal: false,
    };
  },
  async resetRun(req) {
    return {
      oldHead: "",
      newHead: req.target,
      outcome: "success" as const,
      message: `Reset to ${req.target.slice(0, 7)} (${req.mode})`,
      conflictFiles: [],
      backupRef: "refs/gitx/backup/reset-0",
    };
  },
  async undoRewrite() {
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: "Restored previous HEAD",
      conflictFiles: [],
      backupRef: null,
    };
  },
  async extractChanges() {
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: "Extracted selected changes",
      conflictFiles: [],
      backupRef: "refs/gitx/backup/extract-0",
    };
  },
  async dropChanges() {
    return {
      oldHead: "",
      newHead: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      outcome: "success" as const,
      message: "Dropped selected changes",
      conflictFiles: [],
      backupRef: "refs/gitx/backup/drop-changes-0",
    };
  },
  async stageLines(req) {
    emitConsole("cmd", `# stage lines ${req.lines.join(",")} on ${req.filePath}`);
    return this.stagePaths({
      repoId: req.repoId,
      path: req.path,
      paths: [req.filePath],
    });
  },
  async unstageLines(req) {
    emitConsole("cmd", `# unstage lines ${req.lines.join(",")} on ${req.filePath}`);
    return this.unstagePaths({
      repoId: req.repoId,
      path: req.path,
      paths: [req.filePath],
    });
  },
  async revertLines(req) {
    emitConsole("cmd", `# revert lines ${req.lines.join(",")} on ${req.filePath}`);
    return null;
  },
  async changelistList() {
    return structuredClone(mockChangelists);
  },
  async changelistCreate(req) {
    const id = `cl-${Date.now()}`;
    if (req.setActive) {
      for (const l of mockChangelists.lists) l.active = false;
    }
    mockChangelists.lists.push({
      id,
      name: req.name,
      comment: req.comment ?? "",
      active: !!req.setActive,
    });
    if (!mockChangelists.lists.some((l) => l.active)) {
      mockChangelists.lists[0]!.active = true;
    }
    return structuredClone(mockChangelists);
  },
  async changelistRename(req) {
    const l = mockChangelists.lists.find((x) => x.id === req.id);
    if (l) l.name = req.name;
    return structuredClone(mockChangelists);
  },
  async changelistDelete(req) {
    mockChangelists.lists = mockChangelists.lists.filter((l) => l.id !== req.id);
    if (req.moveTo) {
      for (const a of mockChangelists.assignments) {
        if (a.listId === req.id) a.listId = req.moveTo;
      }
    } else {
      mockChangelists.assignments = mockChangelists.assignments.filter((a) => a.listId !== req.id);
    }
    if (!mockChangelists.lists.some((l) => l.active) && mockChangelists.lists[0]) {
      mockChangelists.lists[0].active = true;
    }
    return structuredClone(mockChangelists);
  },
  async changelistSetActive(req) {
    for (const l of mockChangelists.lists) l.active = l.id === req.id;
    return structuredClone(mockChangelists);
  },
  async changelistMove(req) {
    for (const p of req.paths) {
      const existing = mockChangelists.assignments.find((a) => a.path === p);
      if (existing) existing.listId = req.targetListId;
      else mockChangelists.assignments.push({ path: p, listId: req.targetListId, hunkRanges: [] });
    }
    return structuredClone(mockChangelists);
  },
  async stashList() {
    return structuredClone(mockStashes);
  },
  async stashCreate(req) {
    mockStashes.unshift({
      index: 0,
      sha: `${Date.now().toString(16).padStart(40, "c")}`,
      message: req.message,
      branch: mockBranch,
      time: Math.floor(Date.now() / 1000),
    });
    mockStashes.forEach((s, i) => {
      s.index = i;
    });
    emitConsole("cmd", `git stash push -m ${JSON.stringify(req.message)}`);
    return null;
  },
  async stashApply(req) {
    emitConsole("cmd", `git stash apply ${req.stashRef}`);
    return null;
  },
  async stashPop(req) {
    emitConsole("cmd", `git stash pop ${req.stashRef}`);
    const idx = Number(req.stashRef.replace("stash@{", "").replace("}", "")) || 0;
    mockStashes = mockStashes.filter((s) => s.index !== idx);
    mockStashes.forEach((s, i) => {
      s.index = i;
    });
    return null;
  },
  async stashDrop(req) {
    emitConsole("cmd", `git stash drop ${req.stashRef}`);
    const idx = Number(req.stashRef.replace("stash@{", "").replace("}", "")) || 0;
    mockStashes = mockStashes.filter((s) => s.index !== idx);
    mockStashes.forEach((s, i) => {
      s.index = i;
    });
    return null;
  },
  async stashClear() {
    mockStashes = [];
    emitConsole("cmd", "git stash clear");
    return null;
  },
  async stashBranch(req) {
    emitConsole("cmd", `git stash branch ${req.branch} ${req.stashRef}`);
    if (!mockBranches.includes(req.branch)) mockBranches.push(req.branch);
    mockBranch = req.branch;
    return null;
  },
  async stashRestore(req) {
    mockStashes.unshift({
      index: 0,
      sha: req.sha,
      message: req.message,
      branch: mockBranch,
      time: Math.floor(Date.now() / 1000),
    });
    mockStashes.forEach((s, i) => {
      s.index = i;
    });
    return null;
  },
  async shelfList() {
    return structuredClone(mockShelves.filter((s) => !s.system));
  },
  async shelfListDeleted() {
    return [];
  },
  async shelfCreate(req) {
    const entry: ShelfEntry = {
      id: `shelf-${nextShelfId++}`,
      message: req.message,
      createdAt: Math.floor(Date.now() / 1000),
      baseSha: "bbbbbbbccccccccccccccccccccccccccccccc",
      paths: [...req.paths],
      sourceChangelist: req.sourceChangelist ?? null,
      binary: false,
      system: !!req.system,
    };
    mockShelves.unshift(entry);
    return structuredClone(entry);
  },
  async shelfUnshelve(req) {
    const entry = mockShelves.find((s) => s.id === req.id);
    if (req.removeApplied !== false) {
      mockShelves = mockShelves.filter((s) => s.id !== req.id);
    }
    return { applied: entry?.paths ?? [], failed: [] };
  },
  async shelfDelete(req) {
    mockShelves = mockShelves.filter((s) => s.id !== req.id);
    return null;
  },
  async shelfRestore(req) {
    const entry = mockShelves.find((s) => s.id === req.id);
    if (!entry) throw { code: "notFound", message: "shelf not found" };
    return structuredClone(entry);
  },
  async shelfRename(req) {
    const entry = mockShelves.find((s) => s.id === req.id);
    if (!entry) throw { code: "notFound", message: "shelf not found" };
    entry.message = req.message;
    return structuredClone(entry);
  },
  async shelfImport(req) {
    const entry: ShelfEntry = {
      id: `shelf-${nextShelfId++}`,
      message: req.message,
      createdAt: Math.floor(Date.now() / 1000),
      baseSha: "bbbbbbbccccccccccccccccccccccccccccccc",
      paths: [req.patchFile],
      sourceChangelist: null,
      binary: false,
      system: false,
    };
    mockShelves.unshift(entry);
    return structuredClone(entry);
  },
  async ignoreAdd(req) {
    emitConsole("cmd", `# ignore_add → ${req.ignoreFile}`);
    for (const pattern of req.patterns) {
      const f = files.find((x) => x.path === pattern || x.path.endsWith(pattern));
      if (f) {
        f.kind = "ignored";
        f.indexStatus = "!";
        f.worktreeStatus = "!";
      }
    }
    return { ignoreFile: req.ignoreFile, patterns: req.patterns, verified: true };
  },
  async ignoreSuggestPatterns(req) {
    return req.files.map((f) => {
      if (req.ignoreDir) {
        return f.startsWith(`${req.ignoreDir}/`) ? f.slice(req.ignoreDir.length + 1) : f;
      }
      return f;
    });
  },
  async excludeOpen(req) {
    return `${req.path}/.git/info/exclude`;
  },
  async rmCached(req) {
    emitConsole("cmd", `git rm --cached -- ${req.paths.join(" ")}`);
    for (const p of req.paths) {
      const f = files.find((x) => x.path === p);
      if (f) {
        f.kind = "untracked";
        f.indexStatus = "?";
        f.worktreeStatus = "?";
      }
    }
    return null;
  },
  async patchCreate(req) {
    const out = req.output ?? `${req.path}/changes.patch`;
    emitConsole("cmd", `git diff --binary > ${out}`);
    return { path: out, bytes: 128 };
  },
  async patchApply(req) {
    emitConsole("cmd", `git apply ${req.patchFile}`);
    return null;
  },
  async patchApplyClipboard(req) {
    emitConsole("cmd", "git apply <clipboard>");
    void req;
    return null;
  },
  // M7
  async worktreeList(req) {
    return [
      {
        path: req.path,
        head: "abcdef0123456789abcdef0123456789abcdef01",
        branch: "main",
        bare: false,
        detached: false,
        locked: false,
        lockReason: null,
        prunable: false,
        pruneReason: null,
        isMain: true,
        isCurrent: true,
      },
    ];
  },
  async worktreeAdd(req) {
    emitConsole("cmd", `git worktree add ${req.worktreePath} ${req.startRef}`);
    return { worktreePath: req.worktreePath, openAfter: req.openAfter !== false };
  },
  async worktreeRemove(req) {
    emitConsole("cmd", `git worktree remove ${req.worktreePath}`);
    return null;
  },
  async worktreeLock(req) {
    emitConsole("cmd", `git worktree lock ${req.worktreePath}`);
    return null;
  },
  async worktreeUnlock(req) {
    emitConsole("cmd", `git worktree unlock ${req.worktreePath}`);
    return null;
  },
  async worktreePrunePreview() {
    return { paths: [], dryRunOutput: "" };
  },
  async worktreePrune() {
    emitConsole("cmd", "git worktree prune -v");
    return { paths: [], dryRunOutput: "" };
  },
  async worktreeOpenRef(req) {
    emitConsole("cmd", `git fetch ${req.remote} ${req.refspec}`);
    return { worktreePath: req.worktreePath, openAfter: true };
  },
  async worktreeDefaultPath(req) {
    const base = req.repoPath.replace(/[/\\]+$/, "");
    const name = base.split(/[/\\]/).pop() ?? "repo";
    const parent = base.slice(0, Math.max(0, base.length - name.length - 1)) || ".";
    const safe = req.branch.replace(/[^A-Za-z0-9_-]/g, "-");
    return { path: `${parent}/${name}-${safe}` };
  },
  async repoDiscover(req) {
    return [
      {
        id: req.path,
        worktreeRoot: req.path,
        gitDir: `${req.path}/.git`,
        commonDir: `${req.path}/.git`,
        isWorktree: false,
        displayName: req.path.split(/[/\\]/).pop() ?? "repo",
        color: "#3b82f6",
        isSubmodule: false,
      },
    ];
  },
  async multiRootCheckout(req) {
    emitConsole("cmd", `multi-root checkout ${req.target}`);
    return {
      ok: true,
      rolledBack: false,
      steps: req.roots.map((path) => ({
        repoId: path,
        path,
        ok: true,
        previousRef: "main",
        error: null,
      })),
    };
  },
  async multiRootRollback(req) {
    return {
      ok: true,
      rolledBack: true,
      steps: req.steps.map((s) => ({ ...s, ok: true, error: null })),
    };
  },
  async uiSyncBroadcast(payload) {
    void payload;
    return null;
  },
  async parseWslPath(req) {
    if (req.path.includes("wsl$") || req.path.includes("wsl.localhost")) {
      return {
        distro: "Ubuntu",
        linuxPath: "/home/user/proj",
        suggestedGit: "wsl.exe -d Ubuntu git",
      };
    }
    return null;
  },
  async syncFork(req) {
    emitConsole("cmd", `git fetch ${req.parentRemote ?? "upstream"}`);
    return {
      defaultBranch: "main",
      upstreamRef: `${req.parentRemote ?? "upstream"}/main`,
      oldHead: "aaa",
      newHead: "bbb",
      strategy: "merge",
      pushed: req.pushOrigin !== false,
      message: "Synced with upstream",
    };
  },
  async submoduleUpdate() {
    return { items: [], message: "No .gitmodules" };
  },
};
