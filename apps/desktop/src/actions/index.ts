import { registerDefaultGroups } from "./groups";
import { registerDemoActions } from "./definitions/demo";
import { registerVcsActions } from "./definitions/vcs";

export function bootstrapActions() {
  registerDefaultGroups();
  registerVcsActions();
  registerDemoActions();
}

export * from "./registry";
export * from "./keymap";
export * from "./types";
