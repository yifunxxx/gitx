import { expect, it } from "vitest";
import { closeDialog, openDialog, useDialogState } from "./useDialog";

it("resumes the parent dialog after a nested prompt and resolves both promises", async () => {
  const parent = { name: "CloneDialog" };
  const outer = openDialog<string>(parent);
  const inner = openDialog<string>({ name: "CredentialDialog" });
  closeDialog("credentials");
  expect(await inner).toBe("credentials");
  expect(useDialogState().value?.component).toBe(parent);
  closeDialog("cloned");
  expect(await outer).toBe("cloned");
  expect(useDialogState().value).toBeNull();
});

it("closes an invalidated background dialog without dismissing the active prompt", async () => {
  const outer = openDialog<string>({ name: "ConflictsDialog" });
  const id = useDialogState().value!.id;
  const inner = openDialog<string>({ name: "OtherDialog" });
  closeDialog("invalidated", id);
  expect(await outer).toBe("invalidated");
  expect(useDialogState().value?.component).toEqual({ name: "OtherDialog" });
  closeDialog("late response", id);
  expect(useDialogState().value?.component).toEqual({ name: "OtherDialog" });
  closeDialog("done");
  expect(await inner).toBe("done");
});
