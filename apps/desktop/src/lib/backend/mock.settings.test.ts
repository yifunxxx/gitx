import { expect, it } from "vitest";
import { mockBackend as backend } from "./mock";

it("keeps recently opened projects when a stale preferences draft is saved", async () => {
  const draft = await backend.settingsGet();
  const path = "/tmp/preferences-new-project";
  await backend.workspaceOpen({ path });
  const recent = await backend.workspaceRecent();
  expect(recent.paths[0]).toBe(path);
  draft.appearance.theme = "dark";
  draft.recentWorkspaces = [];
  const saved = await backend.settingsSet(draft);
  expect(saved.recentWorkspaces).toEqual(recent.paths);
  expect(saved.appearance.theme).toBe("dark");
  expect(await backend.settingsGet()).toEqual(saved);
  expect(await backend.workspaceRecent()).toEqual(recent);
  saved.recentWorkspaces!.push("mutated response");
  expect(await backend.workspaceRecent()).toEqual(recent);
});
