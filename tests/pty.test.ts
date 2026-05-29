import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PtyShellRunner } from "../src/pty.js";

describe("PTY shell runner", () => {
  it("runs shell commands and captures chat_out", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "smith-pty-"));
    const runner = await PtyShellRunner.start({
      cwd,
      shell: "bash",
      timeoutMs: 2000
    });
    try {
      const echo = await runner.run("echo hello", 2000);
      expect(echo.output).toContain("hello");
      expect(echo.output).not.toContain("echo hello");
      expect(echo.exitCode).toBe(0);

      const ansi = await runner.run("printf '\\033[?2004hhello\\033[0m\\n'", 2000);
      expect(ansi.output).toContain("hello");
      expect(ansi.output).not.toContain("\x1B[?2004h");
      expect(ansi.output).not.toContain("\x1B[0m");
      expect(ansi.exitCode).toBe(0);

      const failed = await runner.run("false", 2000);
      expect(failed.exitCode).toBe(1);
      expect(failed.output).not.toContain("SMITH_EXIT_STATUS");
      expect(failed.output).not.toContain("printf");

      const exited = await runner.run("printf before-exit; exit 7", 2000);
      expect(exited.exitCode).toBe(7);
      expect(exited.output).toContain("before-exit");

      const afterExit = await runner.run("echo still-open", 2000);
      expect(afterExit.exitCode).toBe(0);
      expect(afterExit.output).toContain("still-open");

      const heredocFailed = await runner.run("cat > sample.txt <<'EOF'\nhello\nEOF\nfalse", 2000);
      expect(heredocFailed.exitCode).toBe(1);
      expect(heredocFailed.output).not.toContain("SMITH_EXIT_STATUS");
      expect(heredocFailed.output).not.toContain("printf");

      const heredocSucceeded = await runner.run("cat > sample.txt <<'EOF'\nhello\nEOF\ntest -f sample.txt", 2000);
      expect(heredocSucceeded.exitCode).toBe(0);
      expect(heredocSucceeded.output).not.toContain("cat > sample.txt");
      expect(heredocSucceeded.output).not.toContain("SMITH_EXIT_STATUS");
      expect(heredocSucceeded.output).not.toContain("printf");

      writeFileSync(
        join(cwd, "verify.sh"),
        `set -euo pipefail
test -f sample.txt
node <<'NODE'
const fs = require("node:fs");
if (fs.readFileSync("sample.txt", "utf8").trim() !== "hello") process.exit(1);
NODE
`,
        "utf8"
      );
      const nestedHeredocSucceeded = await runner.run(
        "cat > sample.txt <<'EOF'\nhello\nEOF\nbash verify.sh",
        2000
      );
      expect(nestedHeredocSucceeded.exitCode).toBe(0);
      expect(nestedHeredocSucceeded.output).not.toContain("cat > sample.txt");
      expect(nestedHeredocSucceeded.output).not.toContain("SMITH_EXIT_STATUS");
      expect(nestedHeredocSucceeded.output).not.toContain("printf");

      const multilineOutput = await runner.run("printf '%s\\n' hello\nprintf '%s\\n' world", 2000);
      expect(multilineOutput.exitCode).toBe(0);
      expect(multilineOutput.output).toBe("hello\nworld");

      const result = await runner.run("chat_out done", 2000);
      expect(result.chatOut).toBe("done");
      expect(result.output).toContain("done");
      expect(result.output).not.toContain("__SMITH_CHAT_OUT_START__");
    } finally {
      runner.kill();
    }
  });

  it("falls back to a plain shell runner when PTY is disabled", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "smith-basic-shell-"));
    const runner = await PtyShellRunner.start({
      cwd,
      shell: "bash",
      timeoutMs: 2000,
      env: { ...process.env, SMITH_FORCE_BASIC_SHELL: "1" }
    });
    try {
      const output = await runner.run("printf '%s\\n' hello\nprintf '%s\\n' world", 2000);
      expect(output.output).toBe("hello\nworld");
      expect(output.exitCode).toBe(0);

      const failed = await runner.run("false", 2000);
      expect(failed.exitCode).toBe(1);

      const chatOut = await runner.run("chat_out done", 2000);
      expect(chatOut.chatOut).toBe("done");
      expect(chatOut.output).toContain("done");
      expect(chatOut.output).not.toContain("__SMITH_CHAT_OUT_START__");
    } finally {
      runner.kill();
    }
  });
});
