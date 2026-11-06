#!/usr/bin/env node
/**
 * M0 stub for bindings-check CI.
 * Full flow: `cargo build -p gitx` regenerates bindings.ts under debug_assertions,
 * then this script fails if the working tree has an unexpected diff.
 * Until specta export is wired in release CI, we only assert the file exists.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bindings = path.join(root, "src/lib/backend/bindings.ts");

try {
  await access(bindings);
  console.log("bindings.ts present:", bindings);
} catch {
  console.error("missing bindings.ts — run `cargo build -p gitx` in debug once");
  process.exit(1);
}
