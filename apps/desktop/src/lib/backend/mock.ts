import type { Backend } from "./index";
import type { AppSettings, JobHandle } from "./bindings";

const defaultSettings: AppSettings = {
  schemaVersion: 1,
  appearance: {
    theme: "system",
    palette: "pearl",
    cornerStyle: "small",
  },
  locale: "en",
  gitExecutable: null,
};

let settings = { ...defaultSettings };
const consoleListeners = new Set<(line: { stream: string; line: string }) => void>();

export function onMockConsole(listener: (line: { stream: string; line: string }) => void) {
  consoleListeners.add(listener);
  return () => consoleListeners.delete(listener);
}

function emitConsole(stream: string, line: string) {
  for (const l of consoleListeners) l({ stream, line });
  window.dispatchEvent(new CustomEvent("console://line", { detail: { stream, line } }));
}

export const mockBackend: Backend = {
  async appInfo() {
    return { name: "gitx", version: "0.1.0-web" };
  },
  async gitDetect() {
    return {
      path: "/usr/bin/git",
      version: "git version 2.43.0 (mock)",
      major: 2,
      minor: 43,
      patch: 0,
      supported: true,
    };
  },
  async gitTestExecutable(path: string) {
    return {
      path,
      version: "git version 2.43.0 (mock)",
      major: 2,
      minor: 43,
      patch: 0,
      supported: true,
    };
  },
  async settingsGet() {
    return structuredClone(settings);
  },
  async settingsSet(next) {
    settings = structuredClone(next);
    return structuredClone(settings);
  },
  async jobList() {
    return [];
  },
  async jobCancel() {
    return true;
  },
  async workspaceOpen(req) {
    return {
      path: req.path,
      isRepo: true,
      gitDir: `${req.path}/.git`,
      toplevel: req.path,
    };
  },
  async statusProbe(req): Promise<JobHandle> {
    const jobId = crypto.randomUUID();
    emitConsole("cmd", `git --no-optional-locks status --porcelain=v2 -z --branch  # mock @ ${req.path}`);
    emitConsole("stdout", "# branch.head main");
    emitConsole("stdout", "1 .M N... 100644 100644 100644 … README.md");
    window.dispatchEvent(
      new CustomEvent("job://finished", { detail: { id: jobId, ok: true } }),
    );
    return { jobId };
  },
};
