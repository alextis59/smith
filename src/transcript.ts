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
  if (!shouldSplitProviderTranscript(transcript)) {
    return [
      { role: "system", content: systemPrompt },
      { role: "user", content: truncateTranscriptPreservingRequest(transcript, budget) }
    ];
  }
  return [{ role: "system", content: systemPrompt }, ...transcriptToUserMessages(transcript, budget)];
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

function shouldSplitProviderTranscript(transcript: string): boolean {
  return transcript.includes("smith$ # transcript compacted");
}

function transcriptToUserMessages(transcript: string, budget: number): TranscriptEntry[] {
  const parts = splitTranscriptParts(transcript);
  if (!parts.initialRequest) {
    return [{ role: "user", content: truncateTail(transcript, budget) }];
  }

  const stableMessages = [
    parts.initialRequest,
    parts.stablePrefix.join("\n"),
    parts.compactionSummary ?? ""
  ].filter((content) => content.length > 0);
  const stableChars = stableMessages.reduce((sum, content) => sum + content.length, 0);
  const tail = boundedTail(parts.tailEntries, Math.max(0, budget - stableChars));
  return [...stableMessages, tail].filter((content) => content.length > 0).map((content) => ({ role: "user", content }));
}

function splitTranscriptParts(transcript: string): {
  initialRequest?: string;
  stablePrefix: string[];
  compactionSummary?: string;
  tailEntries: string[];
} {
  const entries = transcript.split(/\n(?=smith\$ )/);
  const initialRequest = entries[0]?.startsWith("smith$ chat_in ") ? entries[0] : undefined;
  const afterInitialRequest = initialRequest ? entries.slice(1) : entries;
  const stablePrefix = takeStablePrefix(afterInitialRequest);
  const afterStablePrefix = afterInitialRequest.slice(stablePrefix.length);
  const compactionSummary = afterStablePrefix[0]?.startsWith("smith$ # transcript compacted")
    ? afterStablePrefix[0]
    : undefined;
  const tailEntries = compactionSummary ? afterStablePrefix.slice(1) : afterStablePrefix;
  return { initialRequest, stablePrefix, compactionSummary, tailEntries };
}

function boundedTail(entries: string[], budget: number): string {
  const joined = entries.join("\n");
  if (joined.length <= budget) return joined;
  const marker = "smith$ # recent terminal transcript\nEarlier terminal transcript omitted from provider context.\n";
  const tailBudget = budget - marker.length;
  if (tailBudget <= 0) return "";

  const kept: string[] = [];
  let used = 0;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const entryCost = entry.length + (kept.length > 0 ? 1 : 0);
    if (used + entryCost > tailBudget) break;
    kept.unshift(entry);
    used += entryCost;
  }
  if (kept.length > 0) return `${marker}${kept.join("\n")}`;
  return `${marker}${truncateTail(joined, tailBudget)}`;
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

function truncateTail(content: string, budget: number): string {
  if (content.length <= budget) return content;
  return budget <= 0 ? "" : content.slice(content.length - budget);
}
