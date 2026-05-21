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
  return `smith$ # user input\n${input}`;
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
  return providerMessagesToMessages(systemPrompt, transcriptToProviderMessages(transcript), maxContextChars);
}

export function providerMessagesToMessages(
  systemPrompt: string,
  providerMessages: TranscriptEntry[],
  maxContextChars: number
): TranscriptEntry[] {
  const budget = Math.max(0, maxContextChars - systemPrompt.length);
  return [{ role: "system", content: systemPrompt }, ...truncateProviderMessages(providerMessages, budget)];
}

export function transcriptToProviderMessages(transcript: string): TranscriptEntry[] {
  const entries = transcript.split(/\n(?=smith\$ )/).filter((entry) => entry.length > 0);
  const messages: TranscriptEntry[] = [];
  for (const entry of entries) {
    if (isUserTranscriptEntry(entry)) {
      appendUserMessage(messages, entry);
      continue;
    }

    const parsed = parseTerminalEntry(entry);
    if (!parsed) {
      appendUserMessage(messages, entry);
      continue;
    }
    messages.push({ role: "assistant", content: parsed.command });
    messages.push({ role: "user", content: terminalOutputMessage(parsed.output) });
  }
  return messages;
}

export function appendProviderTerminalTurn(
  messages: TranscriptEntry[],
  command: string,
  output: string
): TranscriptEntry[] {
  return [
    ...messages,
    { role: "assistant", content: command.trimEnd() },
    { role: "user", content: terminalOutputMessage(output) }
  ];
}

export function appendProviderUserObservation(messages: TranscriptEntry[], output: string): TranscriptEntry[] {
  return [...messages, { role: "user", content: terminalOutputMessage(output) }];
}

export function appendTranscriptObservation(transcript: string, label: string, output: string): string {
  const entry = `smith$ # ${label}\n${output.trimEnd()}`;
  return transcript ? `${transcript}\n${entry}` : entry;
}

export function compactProviderMessages(
  messages: TranscriptEntry[],
  options: {
    keepTurns: number;
    maxSummaryChars: number;
  }
): TranscriptEntry[] {
  const firstAssistant = messages.findIndex((message) => message.role === "assistant");
  if (firstAssistant === -1) return messages;

  const stablePrefix = messages.slice(0, firstAssistant);
  const turns = terminalTurns(messages.slice(firstAssistant));
  if (turns.length <= options.keepTurns) return messages;

  const removed = turns.slice(0, Math.max(0, turns.length - options.keepTurns));
  const kept = turns.slice(turns.length - options.keepTurns).flat();
  const summaryTail = removed
    .flat()
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n")
    .slice(-options.maxSummaryChars);
  const summary = [
    "smith$ # transcript compacted",
    `Earlier transcript compacted: ${removed.length} entries omitted.`,
    summaryTail ? `Recent omitted tail:\n${summaryTail}` : ""
  ]
    .filter(Boolean)
    .join("\n");
  return [...stablePrefix, { role: "user", content: summary }, ...kept];
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
  const initialRequest = isInitialUserInput(parts[0]) ? parts[0] : undefined;
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

function truncateProviderMessages(messages: TranscriptEntry[], budget: number): TranscriptEntry[] {
  if (messageChars(messages) <= budget) return messages;
  if (budget <= 0) return [];

  const first = messages[0];
  if (!first || first.content.length >= budget) {
    const tail = messages.at(-1);
    return tail ? [{ role: tail.role, content: tail.content.slice(tail.content.length - budget) }] : [];
  }

  const marker: TranscriptEntry = {
    role: "user",
    content: "smith$ # context truncated\nEarlier terminal transcript omitted to preserve the active user request."
  };
  const remainingBudget = budget - first.content.length - marker.content.length;
  if (remainingBudget <= 0) return [{ role: first.role, content: first.content.slice(0, budget) }];

  const tail: TranscriptEntry[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 1; index -= 1) {
    const message = messages[index];
    const cost = message.content.length;
    if (used + cost > remainingBudget) break;
    tail.unshift(message);
    used += cost;
  }
  return [first, marker, ...tail];
}

function messageChars(messages: TranscriptEntry[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

function appendUserMessage(messages: TranscriptEntry[], content: string): void {
  const last = messages.at(-1);
  if (last?.role === "user") {
    last.content = `${last.content}\n${content}`;
  } else {
    messages.push({ role: "user", content });
  }
}

function isUserTranscriptEntry(entry: string): boolean {
  return (
    entry.startsWith("smith$ # user input") ||
    entry.startsWith("smith$ chat_in ") ||
    entry.startsWith("smith$ # memory files") ||
    entry.startsWith("smith$ # transcript compacted") ||
    entry.startsWith("smith$ # context truncated") ||
    entry.startsWith("smith$ # recent terminal transcript") ||
    entry.startsWith("smith$ # tool reason") ||
    entry.startsWith("smith$ # timeout")
  );
}

function isInitialUserInput(entry: string | undefined): entry is string {
  return Boolean(entry?.startsWith("smith$ # user input") || entry?.startsWith("smith$ chat_in "));
}

function parseTerminalEntry(entry: string): { command: string; output: string } | undefined {
  if (!entry.startsWith("smith$ ")) return undefined;
  const body = entry.slice("smith$ ".length);
  const firstNewline = body.indexOf("\n");
  if (firstNewline === -1) return { command: body, output: "" };
  return {
    command: body.slice(0, firstNewline).trimEnd(),
    output: body.slice(firstNewline + 1).trimEnd()
  };
}

function terminalOutputMessage(output: string): string {
  const trimmed = output.trimEnd();
  return trimmed.length > 0 ? trimmed : "(no terminal output)";
}

function terminalTurns(messages: TranscriptEntry[]): TranscriptEntry[][] {
  const turns: TranscriptEntry[][] = [];
  let index = 0;
  while (index < messages.length) {
    const current = messages[index];
    if (current.role !== "assistant") {
      turns.push([current]);
      index += 1;
      continue;
    }
    const next = messages[index + 1];
    if (next?.role === "user") {
      turns.push([current, next]);
      index += 2;
    } else {
      turns.push([current]);
      index += 1;
    }
  }
  return turns;
}
