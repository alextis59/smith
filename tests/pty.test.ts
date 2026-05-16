import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PtyShellRunner } from "../src/pty.js";

describe("PTY shell runner", () => {
  it("runs shell commands and captures chat_out", async () => {
    const runner = await PtyShellRunner.start({
      cwd: mkdtempSync(join(tmpdir(), "smith-pty-")),
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

      const heredocFailed = await runner.run("cat > sample.txt <<'EOF'\nhello\nEOF\nfalse", 2000);
      expect(heredocFailed.exitCode).toBe(1);
      expect(heredocFailed.output).not.toContain("SMITH_EXIT_STATUS");
      expect(heredocFailed.output).not.toContain("printf");

      const result = await runner.run("chat_out done", 2000);
      expect(result.chatOut).toBe("done");
      expect(result.output).toContain("done");
      expect(result.output).not.toContain("__SMITH_CHAT_OUT_START__");
    } finally {
      runner.kill();
    }
  });
});
