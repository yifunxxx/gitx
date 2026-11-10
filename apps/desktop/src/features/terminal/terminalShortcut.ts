export function isTerminalToggle(event: KeyboardEvent): boolean {
  return (
    !event.isComposing &&
    !event.repeat &&
    !event.shiftKey &&
    !event.altKey &&
    (event.ctrlKey || event.metaKey) &&
    event.code === "Backquote"
  );
}
