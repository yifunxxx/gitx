/** Clamp a fixed-position menu so it stays inside the viewport. */
export function clampMenuPosition(
  x: number,
  y: number,
  menuWidth = 220,
  menuHeight = 320,
  margin = 8,
): { x: number; y: number } {
  const maxX = Math.max(margin, window.innerWidth - menuWidth - margin);
  const maxY = Math.max(margin, window.innerHeight - menuHeight - margin);
  return {
    x: Math.min(Math.max(margin, x), maxX),
    y: Math.min(Math.max(margin, y), maxY),
  };
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
