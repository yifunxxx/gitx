import { registerDefaultGroups } from "./groups";
import { registerDemoActions } from "./definitions/demo";

export function bootstrapActions() {
  registerDefaultGroups();
  registerDemoActions();
}

export * from "./registry";
export * from "./keymap";
export * from "./types";
