import { shallowRef } from "vue";

export type TerminalDirectoryRequest = {
  cwd: string;
  current: () => boolean;
};

// Keep requests until the lazily mounted terminal has a host. Never persist them:
// their source repository and navigation must still be current when consumed.
export const terminalDirectoryRequests = shallowRef<readonly TerminalDirectoryRequest[]>([]);

export function requestTerminalDirectory(cwd: string, current: () => boolean) {
  if (!current()) return;
  terminalDirectoryRequests.value = [...terminalDirectoryRequests.value, { cwd, current }];
}

export function takeTerminalDirectoryRequest() {
  const request = terminalDirectoryRequests.value[0];
  terminalDirectoryRequests.value = terminalDirectoryRequests.value.slice(1);
  return request;
}
