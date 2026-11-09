#!/usr/bin/env node
/**
 * Basic presence check. Explicit export is available by running the debug
 * executable with GITX_EXPORT_BINDINGS pointing to a destination .ts file.
 * This check does not prove that the checked-in signatures match Rust.
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
  console.error("missing bindings.ts — build the debug app, then run it with GITX_EXPORT_BINDINGS set to the destination");
  process.exit(1);
}
