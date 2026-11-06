import type { Component } from "vue";

export type ActionSource =
  | "menu"
  | "context"
  | "shortcut"
  | "popup"
  | "toolbar"
  | "palette";

export type ActionSelection = {
  files?: string[];
  commits?: string[];
  refs?: string[];
};

export type ActionContext = {
  repoIds: string[];
  selection: ActionSelection;
  source: ActionSource;
  place: string;
  folderPath?: string | null;
};

export type EnabledResult = boolean | { enabled: false; reason: string };

export type ActionDef = {
  id: string;
  title: string;
  description?: string;
  icon?: Component;
  defaultShortcuts?: { mac?: string[]; win?: string[]; linux?: string[] };
  scope?: "global" | "changes" | "log" | "branches" | "diff" | "merge" | "editor";
  when?: (ctx: ActionContext) => boolean;
  enabled?: (ctx: ActionContext) => EnabledResult;
  destructive?: boolean;
  run: (ctx: ActionContext) => Promise<void>;
};

export type ActionGroup = {
  id: string;
  title?: string;
  children: Array<string | "-">;
  popup?: boolean;
};
