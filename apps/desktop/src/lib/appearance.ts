export type Theme = "system" | "light" | "dark" | "liquid-glass" | "liquid-glass-light" | "liquid-glass-dark";

export function isGlassTheme(theme: string) {
  return theme === "liquid-glass" || theme === "liquid-glass-light" || theme === "liquid-glass-dark";
}

export function isDarkTheme(theme: string, systemDark: boolean) {
  if (theme === "dark" || theme === "liquid-glass-dark") return true;
  if (theme === "light" || theme === "liquid-glass-light") return false;
  return systemDark;
}
