import { toRaw } from "vue";

/** Deep-clone a plain JSON-compatible value, stripping Vue proxies. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(toRaw(value))) as T;
}
