import { registerDefaultGroups } from "./groups";
import { registerDemoActions } from "./definitions/demo";
import { registerVcsActions } from "./definitions/vcs";
import { registerM2Actions } from "./definitions/m2";
import { registerM4Actions } from "./definitions/m4";
import { registerM5Actions } from "./definitions/m5";

export function bootstrapActions() {
  registerDefaultGroups();
  registerVcsActions();
  registerM2Actions();
  registerM4Actions();
  registerM5Actions();
  registerDemoActions();
}

export * from "./registry";
export * from "./keymap";
export * from "./types";
