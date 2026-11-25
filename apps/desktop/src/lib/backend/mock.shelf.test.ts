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

it("applies only the selected files and keeps the unselected Shelf remainder", async () => {
  const entry = await backend.shelfCreate({ path: 'demo', message: 'partial', paths: ['a.txt', 'b.txt'], keepChanges: true, sourceChangelist: null });
  for (const paths of [[], ['missing'], ['a.txt', 'missing']]) {
    await expect(backend.shelfUnshelve({ path: 'demo', id: entry.id, paths, removeApplied: true })).rejects.toMatchObject({ code: 'invalidArgument' });
    expect(await backend.shelfList({ path: 'demo' })).toContainEqual(entry);
  }
  expect(await backend.shelfUnshelve({ path: 'demo', id: entry.id, paths: ['a.txt'], removeApplied: false })).toEqual({ applied: ['a.txt'], failed: [] });
  expect(await backend.shelfList({ path: 'demo' })).toContainEqual(entry);
  await backend.shelfUnshelve({ path: 'demo', id: entry.id, paths: ['a.txt'], removeApplied: true });
  expect((await backend.shelfList({ path: 'demo' })).find(s => s.id === entry.id)?.paths).toEqual(['b.txt']);
  expect((await backend.shelfListDeleted({ path: 'demo' })).some(s => s.id === entry.id)).toBe(false);
});

it("rejects missing Shelf operations", async () => {
  await expect(backend.shelfDelete({ path: "demo", id: "missing" })).rejects.toMatchObject({
    code: "notFound",
  });
  await expect(
    backend.shelfUnshelve({ path: "demo", id: "missing", removeApplied: true }),
  ).rejects.toMatchObject({ code: "notFound" });
});
