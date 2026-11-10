// Intl formatter construction is expensive; scrolling must only format values.
const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function formatCommitTime(seconds: number): string {
  try {
    return formatter.format(new Date(seconds * 1000));
  } catch {
    return String(seconds);
  }
}
