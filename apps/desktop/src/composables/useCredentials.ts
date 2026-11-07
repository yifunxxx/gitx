import { openDialog } from "@/composables/useDialog";
import CredentialDialog, {
  type CredentialDialogResult,
} from "@/features/sync/CredentialDialog.vue";
import { getBackend } from "@/lib/backend";
import { formatErrorMessage } from "@/lib/errors";
import { isAuthError, parseAuthTarget } from "@/lib/auth";
import { useBranchesStore } from "@/stores/branchesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { i18n } from "@/i18n";

export type AuthPromptOpts = {
  error?: unknown;
  /** Prefer this URL (e.g. remote fetchUrl) over parsing the error. */
  url?: string | null;
  title?: string;
};

/**
 * Open the in-app credential dialog, persist via askpass session (+ optional
 * credential helper), and return whether the caller should retry the op.
 */
export async function promptCredentials(opts: AuthPromptOpts = {}): Promise<boolean> {
  const ws = useWorkspaceStore();
  const branches = useBranchesStore();
  const settings = useSettingsStore();

  const errText = opts.error != null ? formatErrorMessage(opts.error) : null;
  const remoteUrl =
    opts.url ??
    branches.remotes[0]?.fetchUrl ??
    branches.remotes[0]?.pushUrl ??
    null;
  const fromErr = errText ? parseAuthTarget(errText) : null;
  const fromUrl = remoteUrl ? parseAuthTarget(remoteUrl) : null;

  const url = fromUrl?.url ?? fromErr?.url ?? remoteUrl;
  const host = fromUrl?.host ?? fromErr?.host;
  const protocol = fromUrl?.protocol ?? fromErr?.protocol ?? "https";
  const username = fromErr?.username ?? fromUrl?.username ?? "";

  const result = await openDialog<CredentialDialogResult>(CredentialDialog, {
    title: opts.title ?? i18n.global.t("auth.title"),
    message: i18n.global.t("auth.hint"),
    url,
    host,
    protocol,
    username,
    errorText: errText,
  });

  if (!result?.retry) return false;

  const storeHelper =
    result.storeHelper && (settings.settings?.git?.useCredentialHelper ?? true);

  await getBackend().credentialSessionSet({
    path: ws.repoPath,
    protocol,
    host,
    username: result.username,
    password: result.password,
    storeHelper,
    url,
  });

  return true;
}

/** If `err` is auth-related, prompt for credentials and report whether to retry. */
export async function handleAuthFailure(
  err: unknown,
  opts: Omit<AuthPromptOpts, "error"> = {},
): Promise<boolean> {
  if (!isAuthError(err)) return false;
  return promptCredentials({ ...opts, error: err });
}
