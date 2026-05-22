#!/usr/bin/env node
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { taskSpecs } from "./generate-benchmarks.mjs";

const root = new URL("../benchmarks/", import.meta.url).pathname;
const specs = taskSpecs();
const expectedCount = specs.length;
const expectedSlugs = new Set(specs.map((spec) => spec.slug));
const taskDirs = existsSync(root)
  ? readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory() && existsSync(join(root, name, "Task.md"))).sort()
  : [];

if (taskDirs.length !== expectedCount) fail(`expected ${expectedCount} task directories, found ${taskDirs.length}`);
if (new Set(taskDirs).size !== taskDirs.length) fail("duplicate task directory names found");
for (const taskDir of taskDirs) {
  if (!expectedSlugs.has(taskDir)) fail(`unexpected task directory ${taskDir}`);
}

for (const spec of specs) {
  const taskDir = join(root, spec.slug);
  for (const entry of ["Task.md", "workspace", "verify.sh"]) {
    if (!existsSync(join(taskDir, entry))) fail(`${spec.slug} is missing ${entry}`);
  }
  const mode = statSync(join(taskDir, "verify.sh")).mode;
  if ((mode & 0o111) === 0) fail(`${spec.slug}/verify.sh is not executable`);
}

const tmp = mkdtempSync(join(tmpdir(), "smith-bench-validate-"));
try {
  for (const spec of specs) {
    const workspace = join(tmp, spec.slug);
    cpSync(join(root, spec.slug, "workspace"), workspace, { recursive: true });
    for (const [path, content] of Object.entries(spec.solution)) {
      const file = join(workspace, path);
      mkdirSync(new URL(`file://${file}`).pathname.split("/").slice(0, -1).join("/"), { recursive: true });
      writeFileSync(file, content, "utf8");
    }
    chmodSync(join(root, spec.slug, "verify.sh"), 0o755);
    const result = spawnSync("bash", [join(root, spec.slug, "verify.sh")], { cwd: workspace, encoding: "utf8" });
    if (result.status !== 0) {
      fail(`${spec.slug} verifier failed on solved workspace\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`validated ${expectedCount} benchmark task structures and solved-state verifiers`);

function fail(message) {
  console.error(message);
  process.exit(1);
}
