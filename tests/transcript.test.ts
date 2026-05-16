import { describe, expect, it } from "vitest";
import {
  appendChatIn,
  appendTerminalTurn,
  compactTranscript,
  parseChatOutSentinel,
  stripShellFence,
  transcriptToMessages
} from "../src/transcript.js";

describe("transcript helpers", () => {
  it("strips shell fences only around full responses", () => {
    expect(stripShellFence("```bash\necho hi\n```")).toBe("echo hi");
    expect(stripShellFence("~~~sh\necho hi\n~~~")).toBe("echo hi");
    expect(stripShellFence("echo hi")).toBe("echo hi");
  });

  it("parses chat_out sentinels while preserving visible output", () => {
    const parsed = parseChatOutSentinel("hello\n__SMITH_CHAT_OUT_START__\nanswer\n__SMITH_CHAT_OUT_END__\n");
    expect(parsed.chatOut).toBe("answer");
    expect(parsed.output).toBe("hello\n\n");
  });

  it("formats chat_in and terminal turns", () => {
    expect(appendChatIn("hello")).toContain("SMITH_USER");
    expect(appendTerminalTurn("", "cat README.md", "smith")).toContain("smith$ cat README.md");
  });

  it("keeps system prompt and truncates transcript to context budget", () => {
    const messages = transcriptToMessages("system", "a".repeat(20), 10);
    expect(messages[0]).toEqual({ role: "system", content: "system" });
    expect(messages[1].content).toBe("aaaa");
  });

  it("compacts old terminal turns deterministically", () => {
    const transcript = ["smith$ one\n1", "smith$ two\n2", "smith$ three\n3"].join("\n");
    const compacted = compactTranscript(transcript, { keepTurns: 1, maxSummaryChars: 20 });
    expect(compacted).toContain("Earlier transcript compacted: 2 entries omitted.");
    expect(compacted).toContain("smith$ three");
    expect(compacted).not.toContain("smith$ one");
  });
});
