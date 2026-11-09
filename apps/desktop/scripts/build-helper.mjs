// Keep the askpass sidecar in sync with the app for both local dev and bundles.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const release = process.argv.includes("--release");
function capture(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${command} failed`);
  return result.stdout;
}
const host = /^host: (.+)$/m.exec(capture("rustc", ["-vV"]))?.[1]?.trim();
if (!host) throw new Error("Cannot determine Rust host triple");
const target = process.env.CARGO_BUILD_TARGET || host;
const args = ["build", "-p", "gitx-helper", "--locked"];
if (release) args.push("--release");
if (target !== host) args.push("--target", target);
const build = spawnSync("cargo", args, { cwd: root, stdio: "inherit", windowsHide: true });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);
const metadata = JSON.parse(capture("cargo", ["metadata", "--no-deps", "--format-version", "1"]));
const suffix = target.includes("windows") ? ".exe" : "";
const targetDir = process.env.CARGO_BUILD_TARGET ? join(metadata.target_directory, target) : metadata.target_directory;
const source = join(targetDir, release ? "release" : "debug", `gitx-helper${suffix}`);
const directory = join(root, "src-tauri", "binaries");
mkdirSync(directory, { recursive: true });
copyFileSync(source, join(directory, `gitx-helper-${target}${suffix}`));
console.log(`Built and staged gitx-helper (${target}, ${release ? "release" : "debug"})`);
