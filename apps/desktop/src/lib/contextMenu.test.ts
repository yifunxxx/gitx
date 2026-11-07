import { afterEach, describe, expect, it, vi } from "vitest";
import { placeContextMenu } from "./contextMenu";

describe("placeContextMenu", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("flips above the cursor when space below is tight", () => {
    vi.stubGlobal("window", { innerWidth: 800, innerHeight: 400 });
    const p = placeContextMenu(100, 360, { width: 240, estimatedHeight: 300, margin: 10 });
    expect(p.y + p.maxHeight).toBeLessThanOrEqual(400 - 10);
    expect(p.y).toBeLessThan(360);
    expect(p.maxHeight).toBeGreaterThanOrEqual(120);
  });

  it("clamps horizontally near the right edge", () => {
    vi.stubGlobal("window", { innerWidth: 500, innerHeight: 600 });
    const p = placeContextMenu(480, 40, { width: 240, estimatedHeight: 200, margin: 10 });
    expect(p.x + 240).toBeLessThanOrEqual(500 - 10);
    expect(p.x).toBeGreaterThanOrEqual(10);
  });

  it("keeps maxHeight within the viewport and scrolls when taller than both sides", () => {
    vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 500 });
    const p = placeContextMenu(20, 20, { width: 200, estimatedHeight: 800, margin: 10 });
    expect(p.maxHeight).toBeLessThanOrEqual(500 - 20);
    expect(p.y + p.maxHeight).toBeLessThanOrEqual(500 - 10);
  });

  it("opens below when the menu fits under the cursor", () => {
    vi.stubGlobal("window", { innerWidth: 1000, innerHeight: 800 });
    const p = placeContextMenu(40, 100, { width: 200, estimatedHeight: 200, margin: 10 });
    expect(p.y).toBe(100);
    expect(p.maxHeight).toBe(200);
  });
});
