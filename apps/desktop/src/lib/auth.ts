import { invokeErrorCode, formatErrorMessage } from "./errors";

/** Detect auth / askpass / terminal-prompt failures from invoke payloads or stderr text. */
export function isAuthError(err: unknown): boolean {
  const code = invokeErrorCode(err);
  if (
    code === "authRequired" ||
    code === "AuthRequired" ||
    code === "authFailed" ||
    code === "AuthFailed"
  ) {
    return true;
  }
  const msg = formatErrorMessage(err, "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("terminal prompts disabled") ||
    msg.includes("could not read password") ||
    msg.includes("could not read username") ||
    msg.includes("authentication failed") ||
    msg.includes("http basic access authentication failed") ||
    msg.includes("invalid username or password") ||
    (msg.includes("authentication") && !msg.includes("host key")) ||
    (msg.includes("permission denied") &&
      (msg.includes("publickey") || msg.includes("password")))
  );
}

export type ParsedAuthTarget = {
  protocol: string | null;
  host: string | null;
  username: string | null;
  url: string | null;
};

/** Pull host/user hints from a remote URL or git auth error message. */
export function parseAuthTarget(urlOrErr: string): ParsedAuthTarget {
  const empty: ParsedAuthTarget = {
    protocol: null,
    host: null,
    username: null,
    url: null,
  };
  const candidate = extractUrlCandidate(urlOrErr) ?? urlOrErr.trim();
  if (!candidate) return empty;

  for (const proto of ["https", "http"] as const) {
    const prefix = `${proto}://`;
    if (!candidate.startsWith(prefix)) continue;
    const rest = candidate.slice(prefix.length);
    const authority = rest.split("/")[0] ?? rest;
    const at = authority.lastIndexOf("@");
    if (at >= 0) {
      const user = authority.slice(0, at);
      const hostPort = authority.slice(at + 1);
      return {
        protocol: proto,
        // Keep a non-default port: Git credential helpers scope HTTP entries
        // by host and port, and `https://host:6133` is distinct from `https://host`.
        host: hostPort || null,
        username: user || null,
        url: candidate,
      };
    }
    return {
      protocol: proto,
      host: authority || null,
      username: null,
      url: candidate,
    };
  }

  if (candidate.startsWith("git@")) {
    const host = candidate.slice(4).split(":")[0] ?? "";
    return { protocol: "ssh", host: host || null, username: null, url: candidate };
  }
  if (candidate.startsWith("ssh://")) {
    const rest = candidate.slice("ssh://".length);
    const afterAt = rest.includes("@") ? rest.split("@").slice(1).join("@") : rest;
    const host = (afterAt.split("/")[0] ?? afterAt).split(":")[0] ?? "";
    return { protocol: "ssh", host: host || null, username: null, url: candidate };
  }

  return { ...empty, url: candidate.includes("://") ? candidate : null };
}

function extractUrlCandidate(s: string): string | null {
  for (const quote of ["'", '"'] as const) {
    const start = s.indexOf(quote);
    if (start < 0) continue;
    const after = s.slice(start + 1);
    const end = after.indexOf(quote);
    if (end < 0) continue;
    const inner = after.slice(0, end);
    if (inner.includes("://") || inner.startsWith("git@")) return inner;
  }
  for (const prefix of ["https://", "http://", "ssh://", "git@"]) {
    const idx = s.indexOf(prefix);
    if (idx < 0) continue;
    const rest = s.slice(idx);
    const end = rest.search(/[\s'"]/);
    return end >= 0 ? rest.slice(0, end) : rest;
  }
  return null;
}
