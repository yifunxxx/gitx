import { expect, it } from "vitest";
import { mockBackend as backend } from "./mock";

it("retains deleted Shelf metadata and restores it only once", async () => {
  const entry = await backend.shelfCreate({
    path: "demo",
    message: "recoverable",
    paths: ["a.txt"],
    keepChanges: true,
    sourceChangelist: null,
  });
  await backend.shelfDelete({ path: "demo", id: entry.id });
  expect(await backend.shelfList({ path: "demo" })).not.toContainEqual(entry);
  const deleted = await backend.shelfListDeleted({ path: "demo" });
  expect(deleted).toContainEqual(entry);
  deleted.find((s) => s.id === entry.id)!.paths.push("mutated.txt");
  expect(await backend.shelfRestore({ path: "demo", id: entry.id })).toEqual(entry);
  expect(await backend.shelfListDeleted({ path: "demo" })).not.toContainEqual(entry);
  expect(await backend.shelfList({ path: "demo" })).toContainEqual(entry);
  await expect(backend.shelfRestore({ path: "demo", id: entry.id })).rejects.toMatchObject({
    code: "notFound",
  });
});

it("retains applied Shelves until removal is explicitly requested", async () => {
  const entry = await backend.shelfCreate({
    path: "demo",
    message: "applied",
    paths: ["b.txt"],
    keepChanges: true,
    sourceChangelist: null,
  });
  await backend.shelfUnshelve({ path: "demo", id: entry.id, removeApplied: false });
  expect(await backend.shelfList({ path: "demo" })).toContainEqual(entry);
  await backend.shelfUnshelve({ path: "demo", id: entry.id, removeApplied: true });
  expect(await backend.shelfList({ path: "demo" })).not.toContainEqual(entry);
  expect(await backend.shelfListDeleted({ path: "demo" })).toContainEqual(entry);
  expect(await backend.shelfRestore({ path: "demo", id: entry.id })).toEqual(entry);
});

it("rejects missing Shelf operations", async () => {
  await expect(backend.shelfDelete({ path: "demo", id: "missing" })).rejects.toMatchObject({
    code: "notFound",
  });
  await expect(
    backend.shelfUnshelve({ path: "demo", id: "missing", removeApplied: true }),
  ).rejects.toMatchObject({ code: "notFound" });
});
