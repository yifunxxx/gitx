import { registerDefaultGroups } from "./groups";
import { registerVcsActions } from "./definitions/vcs";
import { registerM2Actions } from "./definitions/m2";
import { registerM4Actions } from "./definitions/m4";
import { registerM5Actions } from "./definitions/m5";
import { registerM6Actions } from "./definitions/m6";
import { registerM7Actions } from "./definitions/m7";
import { registerSettingsActions } from "./definitions/settings";

export function bootstrapActions() {
  registerDefaultGroups();
  registerVcsActions();
  registerM2Actions();
  registerM4Actions();
  registerM5Actions();
  registerM6Actions();
  registerM7Actions();
  registerSettingsActions();
}

export * from "./registry";
export * from "./keymap";
export * from "./types";
