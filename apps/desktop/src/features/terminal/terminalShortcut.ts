export function isTerminalToggle(event: KeyboardEvent): boolean {
  return (
    !event.isComposing &&
    !event.repeat &&
    !event.shiftKey &&
    !event.altKey &&
    (event.ctrlKey || event.metaKey) &&
    // Some native/synthetic input paths omit the physical key code.
    (event.code === "Backquote" || (!event.code && event.key === "`"))
  );
}
