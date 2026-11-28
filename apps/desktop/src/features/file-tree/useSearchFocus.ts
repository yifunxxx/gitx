import { onBeforeUpdate, onUpdated, type Ref } from "vue";

/** Keep keyboard events in the search dialog when a focused control disappears
 * or becomes disabled. Recover only focus owned by this update, so polling and
 * late responses never move focus away from another field or dialog. */
export function useSearchFocus(
  panel: Ref<HTMLElement | null>,
  query: Ref<HTMLInputElement | null>,
  active: () => boolean,
) {
  let previous: HTMLElement | null = null;
  onBeforeUpdate(() => {
    const focused = document.activeElement;
    previous =
      active() && focused instanceof HTMLElement && panel.value?.contains(focused) ? focused : null;
  });
  onUpdated(() => {
    const focused = previous;
    previous = null;
    const root = panel.value;
    if (!focused || !active() || !root?.isConnected || root.closest("[hidden], [inert]")) return;
    if (focused.isConnected && !focused.matches(":disabled")) return;
    if (document.activeElement !== focused && document.activeElement !== document.body) return;
    const input = query.value;
    const target = input && root.contains(input) && !input.matches(":disabled") ? input : root;
    target.focus({ preventScroll: true });
  });
}
