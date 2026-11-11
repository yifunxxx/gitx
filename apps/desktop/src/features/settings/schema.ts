/** Declarative Settings schema (#117–#119). Paths use dotted keys into AppSettings. */

export type SettingControl =
  | { kind: "text"; placeholder?: string }
  | { kind: "number"; min?: number; max?: number; step?: number }
  | { kind: "boolean" }
  | { kind: "select"; options: { value: string; labelKey: string }[] }
  | { kind: "stringList"; placeholder?: string }
  | { kind: "path"; testAction?: "gitExecutable" };

export type SettingField = {
  id: string;
  /** i18n key under settings.fields.* */
  titleKey: string;
  /** Optional search keywords (en + zh) */
  keywords?: string[];
  path: string;
  control: SettingControl;
  /** Scope label for search / source chip */
  scope?: "app" | "repo" | "shared";
};

export type SettingPage = {
  id: string;
  titleKey: string;
  parentId?: string;
  fields: SettingField[];
};

export const SETTINGS_PAGES: SettingPage[] = [
  {
    id: "appearance",
    titleKey: "settings.pages.appearance",
    fields: [
      {
        id: "theme",
        titleKey: "settings.fields.theme",
        keywords: ["theme", "dark", "light", "主题", "暗色", "亮色"],
        path: "appearance.theme",
        control: {
          kind: "select",
          options: [
            { value: "system", labelKey: "settings.theme.system" },
            { value: "light", labelKey: "settings.theme.light" },
            { value: "dark", labelKey: "settings.theme.dark" },
          ],
        },
        scope: "app",
      },
      {
        id: "locale",
        titleKey: "settings.fields.locale",
        keywords: ["language", "locale", "i18n", "语言", "中文", "english"],
        path: "locale",
        control: {
          kind: "select",
          options: [
            { value: "zh-CN", labelKey: "settings.locale.zhCN" },
            { value: "en", labelKey: "settings.locale.en" },
          ],
        },
        scope: "app",
      },
      {
        id: "cornerStyle",
        titleKey: "settings.fields.cornerStyle",
        keywords: ["radius", "corner", "圆角"],
        path: "appearance.cornerStyle",
        control: {
          kind: "select",
          options: [
            { value: "small", labelKey: "settings.corner.small" },
            { value: "large", labelKey: "settings.corner.large" },
            { value: "none", labelKey: "settings.corner.none" },
          ],
        },
        scope: "app",
      },
      {
        id: "palette",
        titleKey: "settings.fields.palette",
        keywords: ["palette", "color", "配色"],
        path: "appearance.palette",
        control: {
          kind: "select",
          options: [
            { value: "pearl", labelKey: "settings.palette.pearl" },
            { value: "graphite", labelKey: "settings.palette.graphite" },
          ],
        },
        scope: "app",
      },
    ],
  },
  {
    id: "vcs-git",
    titleKey: "settings.pages.git",
    fields: [
      {
        id: "gitExecutable",
        titleKey: "settings.fields.gitExecutable",
        keywords: ["git", "path", "executable", "可执行"],
        path: "gitExecutable",
        control: { kind: "path", testAction: "gitExecutable" },
        scope: "app",
      },
      {
        id: "stagingMode",
        titleKey: "settings.fields.stagingMode",
        keywords: ["staging", "changelist", "暂存区"],
        path: "stagingMode",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "showIgnored",
        titleKey: "settings.fields.showIgnoredFiles",
        keywords: ["ignored", "忽略"],
        path: "showIgnoredFiles",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "updateMethod",
        titleKey: "settings.fields.updateMethod",
        keywords: ["update", "merge", "rebase", "pull", "更新"],
        path: "git.updateMethod",
        control: {
          kind: "select",
          options: [
            { value: "merge", labelKey: "settings.update.merge" },
            { value: "rebase", labelKey: "settings.update.rebase" },
            { value: "reset", labelKey: "settings.update.reset" },
          ],
        },
        scope: "app",
      },
      {
        id: "cleanTree",
        titleKey: "settings.fields.cleanTreeMethod",
        keywords: ["stash", "shelve", "clean", "清理"],
        path: "git.cleanTreeMethod",
        control: {
          kind: "select",
          options: [
            { value: "stash", labelKey: "settings.clean.stash" },
            { value: "shelve", labelKey: "settings.clean.shelve" },
          ],
        },
        scope: "app",
      },
      {
        id: "combineStashShelf",
        titleKey: "settings.fields.combineStashesAndShelves",
        keywords: ["stash", "shelf", "combine", "合并"],
        path: "git.combineStashesAndShelves",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "autoFetch",
        titleKey: "settings.fields.autoFetchMinutes",
        keywords: ["fetch", "auto", "interval", "自动"],
        path: "git.autoFetchMinutes",
        control: { kind: "number", min: 0, max: 1440, step: 1 },
        scope: "app",
      },
      {
        id: "protectedBranches",
        titleKey: "settings.fields.protectedBranches",
        keywords: ["protected", "force", "main", "master", "保护"],
        path: "git.protectedBranches",
        control: { kind: "stringList", placeholder: "main, master" },
        scope: "app",
      },
      {
        id: "useCredentialHelper",
        titleKey: "settings.fields.useCredentialHelper",
        keywords: ["credential", "auth", "password", "凭据"],
        path: "git.useCredentialHelper",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "executeBranchOpsAllRoots",
        titleKey: "settings.fields.executeBranchOpsOnAllRoots",
        keywords: ["multi-root", "branch", "多仓库"],
        path: "git.executeBranchOpsOnAllRoots",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "showOptionsBeforeUpdate",
        titleKey: "settings.fields.showOptionsBeforeUpdate",
        keywords: ["update", "dialog", "确认"],
        path: "git.showOptionsBeforeUpdate",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "fetchOnAddRemote",
        titleKey: "settings.fields.fetchOnAddRemote",
        keywords: ["remote", "fetch"],
        path: "git.fetchOnAddRemote",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "cherryPickSuffix",
        titleKey: "settings.fields.cherryPickSuffixProtected",
        keywords: ["cherry-pick", "suffix"],
        path: "git.cherryPickSuffixProtected",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "allowPerHunk",
        titleKey: "settings.fields.allowPerHunkChangelists",
        keywords: ["hunk", "changelist"],
        path: "git.allowPerHunkChangelists",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "forkParent",
        titleKey: "settings.fields.forkParentRemote",
        keywords: ["upstream", "fork", "sync"],
        path: "git.forkParentRemote",
        control: { kind: "text", placeholder: "upstream" },
        scope: "app",
      },
      {
        id: "commitTwMode",
        titleKey: "settings.fields.commitTwMode",
        keywords: ["commit", "tool window", "dock"],
        path: "git.commitTwMode",
        control: {
          kind: "select",
          options: [
            { value: "docked", labelKey: "commitTw.docked" },
            { value: "window", labelKey: "commitTw.window" },
            { value: "float", labelKey: "commitTw.float" },
          ],
        },
        scope: "app",
      },
      {
        id: "logIndexing",
        titleKey: "settings.fields.logIndexing",
        keywords: ["log", "index", "sqlite", "性能"],
        path: "logIndexing",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "logListMode",
        titleKey: "settings.fields.logListMode",
        keywords: ["log", "flat", "tree", "列表", "树"],
        path: "git.logListMode",
        control: {
          kind: "select",
          options: [
            { value: "flat", labelKey: "log.listModeFlat" },
            { value: "tree", labelKey: "log.listModeTree" },
          ],
        },
        scope: "app",
      },
    ],
  },
  {
    id: "vcs-confirmation",
    titleKey: "settings.pages.confirmation",
    fields: [
      {
        id: "closeCommitTw",
        titleKey: "settings.fields.closeCommitTwAfterCommit",
        keywords: ["commit", "close"],
        path: "git.closeCommitTwAfterCommit",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "commitControlsHidden",
        titleKey: "settings.fields.commitControlsHidden",
        keywords: ["commit", "controls", "hide"],
        path: "git.commitControlsHidden",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "groupBranches",
        titleKey: "settings.fields.groupBranchesByDirectory",
        keywords: ["branches", "directory"],
        path: "git.groupBranchesByDirectory",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "showRecentBranches",
        titleKey: "settings.fields.showRecentBranches",
        keywords: ["recent", "branches"],
        path: "git.showRecentBranches",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "showTags",
        titleKey: "settings.fields.showTags",
        keywords: ["tags"],
        path: "git.showTags",
        control: { kind: "boolean" },
        scope: "app",
      },
      {
        id: "showUpdateInfo",
        titleKey: "settings.fields.showUpdateInfo",
        keywords: ["update info"],
        path: "git.showUpdateInfo",
        control: { kind: "boolean" },
        scope: "app",
      },
    ],
  },
  {
    id: "keymap",
    titleKey: "settings.pages.keymap",
    fields: [],
  },
  {
    id: "about",
    titleKey: "settings.pages.about",
    fields: [],
  },
];

export function getByPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]!;
    const next = cur[key];
    if (next == null || typeof next !== "object") {
      cur[key] = {};
    }
    cur = cur[key] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

export function matchField(field: SettingField, query: string, t: (key: string) => string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    field.id,
    t(field.titleKey),
    ...(field.keywords ?? []),
    ...("options" in field.control
      ? field.control.options.map((o) => t(o.labelKey))
      : []),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}
