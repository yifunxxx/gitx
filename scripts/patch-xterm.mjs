// Run on a fresh `pnpm patch @xterm/xterm@6.0.0 --ignore-existing --edit-dir <directory>` checkout,
// then run `pnpm patch-commit <directory>`. Never modify installed node_modules.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const directory = process.argv[2];
assert.ok(directory, "Pass a fresh pnpm patch directory");
const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
assert.equal(pkg.name, "@xterm/xterm");
assert.equal(pkg.version, "6.0.0", "Reassess these fixes before upgrading xterm");
const changes = new Map();
async function replace(file, before, after) {
  const source = changes.get(file) ?? await readFile(path.join(directory, file), "utf8");
  assert.equal(source.split(before).length, 2, `${file}: expected exactly one original snippet`);
  changes.set(file, source.replace(before, after));
}

const cache = "src/browser/ColorContrastCache.ts";
await replace(cache, "export class ColorContrastCache implements IColorContrastCache {", `// Bound retained truecolor pairs independently of scrollback. Eviction changes only
// memoization: colors are recomputed on a miss, with no refresh or timer required.
const MAX_CACHE_ENTRIES = 8192;

export class ColorContrastCache implements IColorContrastCache {
  private _colorSize = 0;
  private _cssSize = 0;`);
for (const [kind, type] of [["Css", "string"], ["Color", "IColor"]]) {
  const field = kind.toLowerCase();
  await replace(cache,
    `  public set${kind}(bg: number, fg: number, value: ${type} | null): void {\n    this._${field}.set(bg, fg, value);`,
    `  public set${kind}(bg: number, fg: number, value: ${type} | null): void {
    if (this._${field}.get(bg, fg) === undefined) {
      if (this._${field}Size >= MAX_CACHE_ENTRIES) {
        this._${field}.clear();
        this._${field}Size = 0;
      }
      this._${field}Size++;
    }
    this._${field}.set(bg, fg, value);`);
}
await replace(cache, "  public clear(): void {\n", "  public clear(): void {\n    this._colorSize = 0;\n    this._cssSize = 0;\n");
await replace("src/browser/renderer/dom/DomRendererRowFactory.ts",
  "this._applyMinimumContrast(charElement, resolvedBg, colors.foreground, cell, bgOverride, fgOverride)",
  "this._applyMinimumContrast(charElement, resolvedBg, isInverse ? colors.background : colors.foreground, cell, bgOverride, fgOverride)");
await replace("src/browser/services/ThemeService.ts",
  "'minimumContrastRatio', () => this._contrastCache.clear()",
  "'minimumContrastRatio', () => { this._contrastCache.clear(); this._halfContrastCache.clear(); }");

// Upstream ships compiled entries. Patch both, so Vite, Node and other consumers
// have the same behavior. Exact-match assertions reject changed minifier output.
for (const [file, ctor, params, inverseBefore, inverseAfter] of [
  ["lib/xterm.mjs", "var Wi=class{constructor(){", "t,e,i",
    "this._applyMinimumContrast(f,it,p.foreground,x,tt,Qi)",
    "this._applyMinimumContrast(f,it,fi?p.background:p.foreground,x,tt,Qi)"],
  ["lib/xterm.js", "t.ColorContrastCache=class{constructor(){", "e,t,i",
    "this._applyMinimumContrast(b,J,S.foreground,F,Y,Z)",
    "this._applyMinimumContrast(b,J,X?S.background:S.foreground,F,Y,Z)"],
]) {
  await replace(file, ctor, `${ctor}this._colorSize=0;this._cssSize=0;`);
  const keys = params.split(",").slice(0, 2).join(",");
  for (const kind of ["Css", "Color"]) {
    const field = kind.toLowerCase();
    await replace(file, `set${kind}(${params}){this._${field}.set(${params})}`,
      `set${kind}(${params}){if(this._${field}.get(${keys})===undefined){if(this._${field}Size>=8192){this._${field}.clear();this._${field}Size=0}this._${field}Size++}this._${field}.set(${params})}`);
  }
  await replace(file, "clear(){this._color.clear(),this._css.clear()}",
    "clear(){this._colorSize=0;this._cssSize=0;this._color.clear(),this._css.clear()}");
  await replace(file, inverseBefore, inverseAfter);
  await replace(file,
    file.endsWith('.mjs') ? '"minimumContrastRatio",()=>this._contrastCache.clear()' : '"minimumContrastRatio",(()=>this._contrastCache.clear())',
    '"minimumContrastRatio",()=>{this._contrastCache.clear();this._halfContrastCache.clear()}');
  // Original mappings no longer describe the edited minified columns. Keep the
  // included TS sources, but do not publish a reference to a misleading map.
  await replace(file, `//# sourceMappingURL=${path.basename(file)}.map`, "// GitX patch: original source map omitted after bundle edits.");
}
// Validate every input before writing anything; rerunning on a patched directory
// is deliberately an error rather than silently applying the fix twice.
for (const [file, content] of changes) await writeFile(path.join(directory, file), content);
console.log(`Patched ${changes.size} xterm 6.0.0 files`);
