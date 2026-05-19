import { describe, expect, it } from "vitest";
import {
  appendChatIn,
  appendTerminalTurn,
  compactTranscript,
  parseChatOutSentinel,
  stripShellFence,
  transcriptToMessageChain,
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

  it("preserves the initial user request when truncating long transcripts", () => {
    const transcript = [
      appendChatIn("Fix the benchmark bug."),
      appendTerminalTurn("", "sed -n '1,200p' big.go", "x".repeat(200)),
      appendTerminalTurn("", "sed -n '200,400p' big.go", "y".repeat(200))
    ].join("\n");

    const messages = transcriptToMessages("system", transcript, 420);
    expect(messages[1].content).toContain("Fix the benchmark bug.");
    expect(messages.some((message) => message.content.includes("Earlier terminal transcript omitted"))).toBe(true);
    expect(messages.at(-1)?.content).toContain("yyyy");
  });

  it("renders terminal turns as assistant commands followed by user terminal output", () => {
    const transcript = [
      appendChatIn("Fix the benchmark bug."),
      "smith$ # memory files\nNo local SMITH.md or SMITH.TASK.md found.",
      appendTerminalTurn("", "cat README.md", "small project")
    ].join("\n");

    const defaultMessages = transcriptToMessages("system", transcript, 10_000);
    expect(defaultMessages).toHaveLength(2);
    expect(defaultMessages[1].content).toContain("smith$ cat README.md");

    const messages = transcriptToMessageChain("system", transcript, 10_000);

    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({ role: "system", content: "system" });
    expect(messages[1].content).toContain("Fix the benchmark bug.");
    expect(messages[1].content).toContain("No local SMITH.md or SMITH.TASK.md found.");
    expect(messages[2]).toEqual({ role: "assistant", content: "cat README.md" });
    expect(messages[3]).toEqual({ role: "user", content: "small project" });
  });

  it("splits compacted stable transcript prefix from the volatile terminal tail", () => {
    const transcript = [
      appendChatIn("Fix the benchmark bug."),
      "smith$ # memory files\nNo local SMITH.md or SMITH.TASK.md found.",
      "smith$ # transcript compacted\nEarlier transcript compacted: 2 entries omitted.\nRecent omitted tail:\nold output",
      appendTerminalTurn("", "sed -n '1,200p' big.go", "x".repeat(200)),
      appendTerminalTurn("", "sed -n '200,400p' big.go", "y".repeat(200))
    ].join("\n");

    const messages = transcriptToMessageChain("system", transcript, 650);

    expect(messages[0]).toEqual({ role: "system", content: "system" });
    expect(messages[1].content).toContain("Fix the benchmark bug.");
    expect(messages[1].content).toContain("No local SMITH.md or SMITH.TASK.md found.");
    expect(messages[1].content).toContain("Earlier transcript compacted: 2 entries omitted.");
    expect(messages.some((message) => message.content.includes("Earlier terminal transcript omitted"))).toBe(true);
    expect(messages.at(-2)).toEqual({ role: "assistant", content: "sed -n '200,400p' big.go" });
    expect(messages.at(-1)?.content).toContain("yyyy");
    expect(messages.some((message) => message.content.includes("sed -n '1,200p' big.go"))).toBe(false);
  });

  it("compacts old terminal turns deterministically", () => {
    const transcript = ["smith$ one\n1", "smith$ two\n2", "smith$ three\n3"].join("\n");
    const compacted = compactTranscript(transcript, { keepTurns: 1, maxSummaryChars: 20 });
    expect(compacted).toContain("Earlier transcript compacted: 2 entries omitted.");
    expect(compacted).toContain("smith$ three");
    expect(compacted).not.toContain("smith$ one");
  });

  it("waits for size and hysteresis thresholds before compacting", () => {
    const transcript = ["smith$ one\n1", "smith$ two\n2", "smith$ three\n3"].join("\n");

    expect(
      compactTranscript(transcript, {
        keepTurns: 1,
        maxSummaryChars: 20,
        minChars: transcript.length + 1
      })
    ).toBe(transcript);

    expect(
      compactTranscript(transcript, {
        keepTurns: 1,
        maxSummaryChars: 20,
        hysteresisTurns: 2
      })
    ).toBe(transcript);
  });

  it("preserves the initial user request when compacting old turns", () => {
    const transcript = [
      appendChatIn("Implement the requested source change."),
      appendTerminalTurn("", "one", "1"),
      appendTerminalTurn("", "two", "2"),
      appendTerminalTurn("", "three", "3")
    ].join("\n");
    const compacted = compactTranscript(transcript, { keepTurns: 1, maxSummaryChars: 20 });

    expect(compacted).toContain("Implement the requested source change.");
    expect(compacted).toContain("Earlier transcript compacted: 2 entries omitted.");
    expect(compacted).toContain("smith$ three");
    expect(compacted).not.toContain("smith$ one");
  });

  it("preserves stable memory presence before compaction summaries", () => {
    const transcript = [
      appendChatIn("Implement the requested source change."),
      "smith$ # memory files\nNo local SMITH.md or SMITH.TASK.md found.",
      appendTerminalTurn("", "one", "1"),
      appendTerminalTurn("", "two", "2"),
      appendTerminalTurn("", "three", "3")
    ].join("\n");
    const compacted = compactTranscript(transcript, { keepTurns: 1, maxSummaryChars: 20 });

    expect(compacted.indexOf("smith$ # memory files")).toBeLessThan(compacted.indexOf("smith$ # transcript compacted"));
    expect(compacted).toContain("No local SMITH.md or SMITH.TASK.md found.");
    expect(compacted).toContain("smith$ three");
  });
});
