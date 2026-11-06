/** Tauri/`AppError` payload rejected by `invoke` (plain object, not `Error`). */
export type InvokeErrorLike = {
  message?: unknown;
  code?: unknown;
  gitStderr?: unknown;
  command?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Extract a human-readable message from invoke/backend errors.
 * Avoids `String(err)` → `[object Object]` for serialized `AppError` payloads.
 */
export function formatErrorMessage(
  err: unknown,
  fallback = "Unknown error",
): string {
  if (err == null) return fallback;
  if (typeof err === "string") {
    const trimmed = err.trim();
    return trimmed || fallback;
  }
  if (err instanceof Error) {
    const msg = err.message?.trim();
    return msg || fallback;
  }
  if (isRecord(err)) {
    const message = err.message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
    const gitStderr = err.gitStderr;
    if (typeof gitStderr === "string" && gitStderr.trim()) {
      return gitStderr.trim();
    }
    // Rare: nested `{ error: { message } }` / `{ data: … }`
    for (const key of ["error", "data", "payload", "cause"] as const) {
      if (key in err) {
        const nested = formatErrorMessage(err[key], "");
        if (nested) return nested;
      }
    }
  }
  try {
    const json = JSON.stringify(err);
    if (json && json !== "{}" && json !== "null") return json;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function invokeErrorCode(err: unknown): string | null {
  if (!isRecord(err)) return null;
  return typeof err.code === "string" ? err.code : null;
}

/** Prefer localized Git-not-found copy; otherwise the real backend message. */
export function formatGitDetectError(
  err: unknown,
  notFoundMessage: string,
): string {
  const code = invokeErrorCode(err);
  if (code === "gitNotFound" || code === "GitNotFound") {
    return notFoundMessage;
  }
  const msg = formatErrorMessage(err, "");
  if (!msg || msg === "[object Object]") {
    return notFoundMessage;
  }
  return msg;
}
