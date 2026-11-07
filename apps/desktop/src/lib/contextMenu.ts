/** Viewport-aware placement for fixed context menus (flip + clamp + scroll cap). */

export type MenuPlacement = {
  x: number;
  y: number;
  /** CSS max-height so long menus scroll instead of clipping. */
  maxHeight: number;
};

export type PlaceMenuOptions = {
  width?: number;
  /** Natural / estimated menu height before clamping. */
  estimatedHeight?: number;
  margin?: number;
};

/**
 * Place a fixed menu near (x, y). Opens below when it fits; otherwise flips
 * above the cursor. Always returns a maxHeight that fits the chosen side so
 * callers can set overflow-y: auto (reka-style collision).
 */
export function placeContextMenu(
  x: number,
  y: number,
  opts: PlaceMenuOptions = {},
): MenuPlacement {
  const width = opts.width ?? 240;
  const margin = opts.margin ?? 10;
  const estimatedHeight = Math.max(48, opts.estimatedHeight ?? 320);
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = x;
  if (left + width + margin > vw) left = vw - width - margin;
  left = Math.min(Math.max(margin, left), Math.max(margin, vw - width - margin));

  const spaceBelow = Math.max(0, vh - margin - y);
  const spaceAbove = Math.max(0, y - margin);

  let top: number;
  let maxHeight: number;

  if (estimatedHeight <= spaceBelow) {
    // Fits below the cursor.
    top = y;
    maxHeight = estimatedHeight;
  } else if (estimatedHeight <= spaceAbove) {
    // Fits above — flip.
    maxHeight = estimatedHeight;
    top = y - maxHeight;
  } else if (spaceAbove > spaceBelow) {
    // Neither side fits full height; use the larger side (above).
    maxHeight = Math.max(120, spaceAbove);
    top = y - maxHeight;
  } else {
    // Use below with scroll.
    top = y;
    maxHeight = Math.max(120, spaceBelow);
  }

  // Final clamp — never paint outside the viewport.
  if (top < margin) top = margin;
  if (top + maxHeight > vh - margin) {
    maxHeight = Math.max(120, vh - margin - top);
  }

  return { x: left, y: top, maxHeight };
}

/** @deprecated Prefer placeContextMenu (includes maxHeight). */
export function clampMenuPosition(
  x: number,
  y: number,
  menuWidth = 220,
  menuHeight = 320,
  margin = 10,
): { x: number; y: number } {
  const p = placeContextMenu(x, y, {
    width: menuWidth,
    estimatedHeight: menuHeight,
    margin,
  });
  return { x: p.x, y: p.y };
}

/** Re-place using the panel's natural size after mount / content paint. */
export function refineMenuPlacement(
  el: HTMLElement,
  anchorX: number,
  anchorY: number,
  margin = 10,
): MenuPlacement {
  const prevMax = el.style.maxHeight;
  el.style.maxHeight = "none";
  const height = el.scrollHeight;
  const width = Math.max(el.offsetWidth, el.scrollWidth);
  el.style.maxHeight = prevMax;
  return placeContextMenu(anchorX, anchorY, {
    width,
    estimatedHeight: height,
    margin,
  });
}

/** Mark that a local context menu handled this event (stops global host). */
export function markContextHandled(e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
  (e as MouseEvent & { __gitxCtxHandled?: boolean }).__gitxCtxHandled = true;
}

export function wasContextHandled(e: MouseEvent): boolean {
  return !!(e as MouseEvent & { __gitxCtxHandled?: boolean }).__gitxCtxHandled;
}
