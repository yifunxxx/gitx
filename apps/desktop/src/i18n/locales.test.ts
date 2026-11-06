import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

function keysOf(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") return keysOf(v as Record<string, unknown>, path);
    return [path];
  });
}

describe("i18n key parity", () => {
  it("zh-CN has the same keys as en", () => {
    expect(keysOf(zh).sort()).toEqual(keysOf(en).sort());
  });
});
