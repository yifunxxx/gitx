import { defineAsyncComponent } from "vue";
import { openDialog } from "./useDialog";

const ConfirmDialog = defineAsyncComponent(
  () => import("@/components/common/ConfirmDialog.vue"),
);
const PromptDialog = defineAsyncComponent(
  () => import("@/components/common/PromptDialog.vue"),
);

export async function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
}): Promise<boolean> {
  return Boolean(
    await openDialog<boolean>(ConfirmDialog, {
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel,
      destructive: opts.destructive,
    }),
  );
}

/** In-app text prompt. Returns `null` when cancelled. */
export async function promptDialog(opts: {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  allowEmpty?: boolean;
}): Promise<string | null> {
  const result = await openDialog<string | null>(PromptDialog, {
    title: opts.title,
    message: opts.message,
    defaultValue: opts.defaultValue ?? "",
    placeholder: opts.placeholder,
    confirmLabel: opts.confirmLabel,
    allowEmpty: opts.allowEmpty ?? true,
  });
  return result ?? null;
}
