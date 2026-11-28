import { afterEach, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";

type CachedColor = { css: string; rgba: number };
type Cache = {
  getColor(bg: number, fg: number): CachedColor | null | undefined;
  setColor(bg: number, fg: number, value: CachedColor | null): void;
  getCss(bg: number, fg: number): string | null | undefined;
  setCss(bg: number, fg: number, value: string | null): void;
  clear(): void;
};
const terminals: Terminal[] = [];
afterEach(() => {
  for (const terminal of terminals.splice(0)) terminal.dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  const terminal = new Terminal({ minimumContrastRatio: 4.5 });
  terminals.push(terminal);
  const host = document.createElement("div");
  document.body.append(host);
  terminal.open(host);
  // Inspect the installed runtime, not a mock or a separately compiled copy of
  // the dependency source. Browser tests cover the resulting rendered colors.
  const core = (
    terminal as unknown as {
      _core: { _themeService: { colors: { contrastCache: Cache; halfContrastCache: Cache } } };
    }
  )._core;
  return {
    terminal,
    caches: [core._themeService.colors.contrastCache, core._themeService.colors.halfContrastCache],
  };
}

for (const kind of ["Color", "Css"] as const) {
  for (const dim of [false, true]) {
    it(`bounds ${dim ? "dim" : "normal"} ${kind} pairs across different backgrounds, including null results`, () => {
      const { caches } = setup();
      const cache = caches[dim ? 1 : 0];
      const set = (bg: number, fg: number) =>
        kind === "Color" ? cache.setColor(bg, fg, null) : cache.setCss(bg, fg, null);
      const get = (bg: number, fg: number) =>
        kind === "Color" ? cache.getColor(bg, fg) : cache.getCss(bg, fg);
      for (let i = 0; i < 8192; i++) set(i % 17, i);
      expect(get(0, 0)).toBeNull();
      // Repeated existing pairs must not evict the working set.
      for (let i = 0; i < 20000; i++) set((i % 8192) % 17, i % 8192);
      expect(get(0, 0)).toBeNull();
      set(0, 8192);
      expect(get(0, 0)).toBeUndefined();
      expect(get(0, 8192)).toBeNull();
      // Recomputed entries and subsequent eviction cycles remain usable.
      for (let i = 0; i < 24000; i++) set(1, i);
      expect(get(1, 0)).toBeUndefined();
      expect(get(1, 23999)).toBeNull();
    });
  }
}

it("preserves values and independently evicts color and CSS entries", () => {
  const { caches } = setup();
  const [cache, dim] = caches;
  const color = { css: "#123456", rgba: 0x123456ff };
  cache.setColor(1, 1, color);
  cache.setCss(1, 1, color.css);
  dim.setColor(1, 1, null);
  for (let i = 2; i <= 8193; i++) cache.setColor(i, i, null);
  expect(cache.getColor(1, 1)).toBeUndefined();
  expect(cache.getCss(1, 1)).toBe(color.css);
  expect(dim.getColor(1, 1)).toBeNull();
  cache.setColor(1, 1, color);
  expect(cache.getColor(1, 1)).toEqual(color);
});

it("resets both data and capacity on theme and contrast changes", () => {
  const { terminal, caches } = setup();
  for (const reset of [
    () => {
      terminal.options.theme = { foreground: "#eeeeee", background: "#141417" };
    },
    () => {
      terminal.options.minimumContrastRatio = 5;
    },
  ]) {
    for (const cache of caches)
      for (let i = 0; i < 17; i++) {
        cache.setColor(1, i, null);
        cache.setCss(1, i, null);
      }
    reset();
    for (const cache of caches) {
      expect(cache.getColor(1, 0)).toBeUndefined();
      expect(cache.getCss(1, 0)).toBeUndefined();
      // Theme changes may synchronously render one default-color pair.
      for (let i = 0; i < 8191; i++) {
        cache.setColor(2, i, null);
        cache.setCss(2, i, null);
      }
      expect(cache.getColor(2, 0)).toBeNull();
      expect(cache.getCss(2, 0)).toBeNull();
      cache.clear();
      for (let i = 0; i < 8192; i++) {
        cache.setColor(3, i, null);
        cache.setCss(3, i, null);
      }
      expect(cache.getColor(3, 0)).toBeNull();
      expect(cache.getCss(3, 0)).toBeNull();
      cache.clear();
    }
  }
});

it("corrects the actual inverse default foreground against an ANSI background", async () => {
  const { terminal } = setup();
  terminal.options.theme = { foreground: "#09090b", background: "#ffffff" };
  await new Promise<void>((done) => terminal.write("\x1b[7;33minverse\x1b[0m", done));
  await vi.waitFor(() => {
    const text = [...document.querySelectorAll<HTMLElement>(".xterm-rows span")].find(
      (element) => element.textContent === "inverse",
    );
    expect(text).toBeDefined();
    // Previously contrast was calculated using #09090b, and the uncorrected
    // white inverse foreground was emitted via a class with no inline color.
    expect(text?.style.color).toMatch(/^(rgb|#)/);
    expect(text?.style.color).not.toBe("rgb(255, 255, 255)");
  });
  terminal.select(0, 0, 7);
  expect(terminal.getSelection()).toBe("inverse");
});
