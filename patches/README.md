# xterm 6.0.0

The pnpm patch fixes two QA163 issues in the dependency, without private runtime
hooks in TerminalView:

- Contrast caches retain at most 8192 pairs per map (normal/dim, color/CSS).
  Inserting a new pair into a full map clears that map; duplicates and cached
  `null` results do not use more capacity. A miss recomputes the same color.
  Theme/contrast changes reset counts along with data. There is no timer, extra
  redraw or per-output scan. At most 32768 pairs can be retained per terminal
  across all four maps; the DOM renderer normally uses only the color maps.
- DOM inverse default foreground is evaluated using the actual background
  color that becomes the foreground. Selection/decoration overrides and DIM's
  deliberately weaker appearance retain upstream behavior.
- Changing the contrast threshold clears the DIM cache as well as the normal
  cache, so previously computed values cannot outlive the threshold they used.
  GitX currently keeps this option fixed; this also preserves the dependency's
  public option behavior for future settings.

The package ships minified CommonJS and ESM bundles, hence the large generated
diff. The readable source hunks and `scripts/patch-xterm.mjs` describe the changes.
Both entry points are patched. Their original source-map references are removed
because their column mappings would otherwise be stale; packaged TS sources
remain available.

To reproduce with pnpm 10.33.4:

```sh
pnpm patch @xterm/xterm@6.0.0 --ignore-existing --edit-dir /absolute/path/to/fresh-directory
node scripts/patch-xterm.mjs /absolute/path/to/fresh-directory
pnpm patch-commit /absolute/path/to/fresh-directory
pnpm install --frozen-lockfile
```

The generator requires exact original snippets and validates all files before
writing. Reassess against upstream source on upgrades; never apply this patch to
a different version or disable the patch to make an installation pass.

Evidence and limitations: [QA163](../docs/qa-terminal-cache-2026-11-28.md).
