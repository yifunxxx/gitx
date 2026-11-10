#!/usr/bin/env node
/**
 * Presence check only; this does not prove that signatures match Rust.
 * For explicit generation, run a debug executable with GITX_EXPORT_BINDINGS
 * naming the output .ts file. Normal builds and app startup do not export.
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
  console.error("missing bindings.ts — build the debug app, then run it with GITX_EXPORT_BINDINGS naming the output .ts file (see README)");
  process.exit(1);
}
