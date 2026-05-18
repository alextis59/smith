export type TranscriptEntry = {
  role: "system" | "user" | "assistant";
  content: string;
};

export const CHAT_OUT_START = "__SMITH_CHAT_OUT_START__";
export const CHAT_OUT_END = "__SMITH_CHAT_OUT_END__";

export type ChatOutParseResult = {
  output: string;
  chatOut?: string;
};

export function appendChatIn(input: string): string {
  return `smith$ chat_in <<'SMITH_USER'\n${input}\nSMITH_USER`;
}

export function stripShellFence(text: string): string {
  const trimmed = text.trim();
  const match = /^(?:```|~~~)(?:sh|shell|bash)?\s*\n([\s\S]*?)\n(?:```|~~~)\s*$/i.exec(trimmed);
  return match ? match[1].trimEnd() : text;
}

export function parseChatOutSentinel(output: string): ChatOutParseResult {
  const start = output.indexOf(CHAT_OUT_START);
  if (start === -1) return { output };
  const end = output.indexOf(CHAT_OUT_END, start + CHAT_OUT_START.length);
  if (end === -1) return { output };

  const before = output.slice(0, start);
  const rawMessage = output.slice(start + CHAT_OUT_START.length, end);
  const after = output.slice(end + CHAT_OUT_END.length);
  const chatOut = rawMessage.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  return {
    output: `${before}${after}`.replace(/\n{3,}/g, "\n\n"),
    chatOut
  };
}

export function transcriptToMessages(
  systemPrompt: string,
  transcript: string,
  maxContextChars: number
): TranscriptEntry[] {
  const budget = Math.max(0, maxContextChars - systemPrompt.length);
  const content = truncateTranscriptPreservingRequest(transcript, budget);
  return [
    { role: "system", content: systemPrompt },
    { role: "user", content }
  ];
}

export function appendTerminalTurn(transcript: string, command: string, output: string): string {
  const entry = `smith$ ${command.trimEnd()}\n${output.trimEnd()}`;
  return transcript ? `${transcript}\n${entry}` : entry;
}

export function compactTranscript(
  transcript: string,
  options: {
    keepTurns: number;
    maxSummaryChars: number;
    minChars?: number;
    hysteresisTurns?: number;
  }
): string {
  if (transcript.length < (options.minChars ?? 0)) return transcript;
  const parts = transcript.split(/\n(?=smith\$ )/);
  const initialRequest = parts[0]?.startsWith("smith$ chat_in ") ? parts[0] : undefined;
  const afterInitialRequest = initialRequest ? parts.slice(1) : parts;
  const stablePrefix = takeStablePrefix(afterInitialRequest);
  const candidates = afterInitialRequest.slice(stablePrefix.length);
  const triggerTurns = options.keepTurns + (options.hysteresisTurns ?? 0);
  if (candidates.length <= triggerTurns) return transcript;
  const removed = candidates.slice(0, Math.max(0, candidates.length - options.keepTurns));
  const kept = candidates.slice(candidates.length - options.keepTurns);
  const summaryText = removed.join("\n").slice(-options.maxSummaryChars);
  const summary = [
    "smith$ # transcript compacted",
    `Earlier transcript compacted: ${removed.length} entries omitted.`,
    summaryText ? `Recent omitted tail:\n${summaryText}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  return [initialRequest, stablePrefix.join("\n"), summary, kept.join("\n")].filter(Boolean).join("\n");
}

function takeStablePrefix(entries: string[]): string[] {
  const stable: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith("smith$ # memory files")) {
      stable.push(entry);
      continue;
    }
    break;
  }
  return stable;
}

function truncateTranscriptPreservingRequest(transcript: string, budget: number): string {
  if (transcript.length <= budget) return transcript;
  const parts = transcript.split(/\n(?=smith\$ )/);
  const initialRequest = parts[0]?.startsWith("smith$ chat_in ") ? parts[0] : undefined;
  if (!initialRequest || initialRequest.length >= budget) return transcript.slice(transcript.length - budget);

  const marker = "\nsmith$ # context truncated\nEarlier terminal transcript omitted to preserve the active user request.\n";
  const tailBudget = budget - initialRequest.length - marker.length;
  if (tailBudget <= 0) return transcript.slice(transcript.length - budget);
  return `${initialRequest}${marker}${transcript.slice(transcript.length - tailBudget)}`;
}
