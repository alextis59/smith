#!/usr/bin/env node
import { createServer } from "node:http";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBenchmarkTask } from "../dist/src/benchmark/runner.js";
import { taskSpecs } from "./generate-benchmarks.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const selected = new Set([
  "001-release-note-summary",
  "011-parse-port-default",
  "026-quiet-mode-plumbing",
  "055-editorconfig-tightening",
  "068-redact-sensitive-fields",
  "080-semver-prerelease-sort",
  "091-command-router-refactor",
  "100-billing-rules-update",
  "101-workflow-policy-engine"
]);

const runAll = process.argv.includes("--all");
const samples = taskSpecs().filter((spec) => runAll || selected.has(spec.slug));
const toolCalls = samples.flatMap(solutionToolCalls);
const provider = await startFakeProvider(toolCalls);
const tmp = mkdtempSync(join(tmpdir(), "smith-benchmark-sample-"));

try {
  for (const spec of samples) {
    const taskCopy = join(tmp, spec.slug);
    cpSync(join(repoRoot, "benchmarks", spec.slug), taskCopy, { recursive: true });
    mkdirSync(join(taskCopy, "workspace", ".smith"), { recursive: true });
    writeFileSync(
      join(taskCopy, "workspace", ".smith", "config.toml"),
      `default_profile = "fake"

[profiles.fake]
adapter = "openai-chat"
base_url = "${provider.baseUrl}/v1"
model = "fake-model"

[runtime]
danger_review = "off"
timeout_ms = 10000
`,
      "utf8"
    );
    const result = await runBenchmarkTask(taskCopy, { timeoutMs: 120_000 });
    const status = result.passed ? "PASS" : "FAIL";
    console.log(`${status} ${spec.slug} ${result.durationMs}ms`);
    if (!result.passed) {
      console.error(result.stderr);
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await new Promise((resolve) => provider.server.close(() => resolve()));
  rmSync(tmp, { recursive: true, force: true });
}

function solutionToolCalls(spec) {
  const payload = Buffer.from(JSON.stringify(spec.solution), "utf8").toString("base64");
  return [
    {
      name: "run",
      arguments: {
        reason: "apply generated benchmark solution",
        command: `node -e 'const fs=require("node:fs");const path=require("node:path");const files=JSON.parse(Buffer.from("${payload}","base64").toString("utf8"));for (const [file,content] of Object.entries(files)){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,content,"utf8");}'`
      }
    },
    {
      name: "finish",
      arguments: {
        reason: "sample solution applied",
        message: `sample solved ${spec.slug}`
      }
    }
  ];
}

async function startFakeProvider(toolCalls) {
  let count = 0;
  const server = createServer((request, response) => {
    request.resume();
    const toolCall = toolCalls[Math.min(count, toolCalls.length - 1)];
    count += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: `call_${count}`,
                  type: "function",
                  function: {
                    name: toolCall.name,
                    arguments: JSON.stringify(toolCall.arguments)
                  }
                }
              ]
            }
          }
        ]
      })
    );
  });

  await new Promise((resolve) => server.listen(0, "0.0.0.0", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP server address");
  return { baseUrl: `http://host.docker.internal:${address.port}`, server };
}
