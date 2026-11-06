import type { Backend } from "./index";
import type {
  AppSettings,
  CommitDetails,
  DiffFileResult,
  DiffHunk,
  FileChange,
  JobHandle,
  LogCommit,
  StatusSnapshot,
} from "./bindings";

const defaultSettings: AppSettings = {
  schemaVersion: 1,
  appearance: {
    theme: "system",
    palette: "pearl",
    cornerStyle: "small",
  },
  locale: "en",
  gitExecutable: null,
  recentWorkspaces: ["/tmp/demo-repo"],
  stagingMode: true,
  logIndexing: true,
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

function statusSnapshot(path: string): StatusSnapshot {
  return {
    repoId: path,
    version: Date.now(),
    branch: {
      head: "main",
      upstream: null,
      ahead: 1,
      behind: 0,
      detached: false,
    },
    files: structuredClone(files),
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
      toplevel: req.path,
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
    return statusSnapshot(req.path);
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
};
