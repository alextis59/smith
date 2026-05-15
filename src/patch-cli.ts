import { readFileSync } from "node:fs";
import { applySmithPatch } from "./patch.js";

try {
  const patch = readFileSync(0, "utf8");
  const result = applySmithPatch(patch);
  process.stdout.write(`Applied patch to ${result.changedFiles.join(", ")}\n`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`smith_patch: ${message}\n`);
  process.exitCode = 1;
}
