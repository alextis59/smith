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

const TOKEN_CHARS = 4;
const MESSAGE_TOKEN_OVERHEAD = 4;
const COMPACTED_ACTION_PREFIX = "smith$ # compacted action";
const CONTEXT_COMPACTED_PREFIX = "smith$ # context compacted";
const CONTEXT_COMPACTED_ENTRY = `${CONTEXT_COMPACTED_PREFIX}
Context has been compacted: earlier tool action parameters and outputs were removed. Rerun focused commands if those details are needed.`;

export type TranscriptCompactionResult = {
  transcript: string;
  changed: boolean;
  beforeTokens: number;
  afterTokens: number;
  redactedActions: number;
  removedActions: number;
  targetTokens?: number;
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
  maxContextTokens: number
): TranscriptEntry[] {
  return providerMessagesToMessages(systemPrompt, transcriptToProviderMessages(transcript), maxContextTokens);
}

export function providerMessagesToMessages(
  systemPrompt: string,
  providerMessages: TranscriptEntry[],
  maxContextTokens: number
): TranscriptEntry[] {
  const budget = Math.max(0, maxContextTokens - estimateTextTokens(systemPrompt));
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

export function appendTerminalTurn(transcript: string, command: string, output: string): string {
  const entry = `smith$ ${command.trimEnd()}\n${output.trimEnd()}`;
  return transcript ? `${transcript}\n${entry}` : entry;
}

export function estimateTranscriptContextTokens(systemPrompt: string, transcript: string): number {
  return estimateMessagesTokens([{ role: "system", content: systemPrompt }, ...transcriptToProviderMessages(transcript)]);
}

export function compactTranscriptToTokenBudget(
  transcript: string,
  options: {
    maxTokens: number;
    systemPrompt: string;
  }
): TranscriptCompactionResult {
  const maxTokens = Math.max(1, options.maxTokens);
  const beforeTokens = estimateTranscriptContextTokens(options.systemPrompt, transcript);
  if (beforeTokens < maxTokens) {
    return {
      transcript,
      changed: false,
      beforeTokens,
      afterTokens: beforeTokens,
      redactedActions: 0,
      removedActions: 0
    };
  }

  const redacted = redactTranscriptActions(transcript);
  const targetTokens = Math.max(1, Math.floor(maxTokens / 2));
  const backup =
    estimateTranscriptContextTokens(options.systemPrompt, redacted.transcript) > maxTokens
      ? removeOldestCompactedActions(redacted.transcript, options.systemPrompt, targetTokens)
      : { transcript: redacted.transcript, removedActions: 0 };
  const afterTokens = estimateTranscriptContextTokens(options.systemPrompt, backup.transcript);
  const changed = backup.transcript !== transcript;

  return {
    transcript: backup.transcript,
    changed,
    beforeTokens,
    afterTokens,
    redactedActions: redacted.redactedActions,
    removedActions: backup.removedActions,
    ...(backup.removedActions > 0 ? { targetTokens } : {})
  };
}

function truncateProviderMessages(messages: TranscriptEntry[], budgetTokens: number): TranscriptEntry[] {
  if (estimateMessagesTokens(messages) <= budgetTokens) return messages;

  const first = messages[0];
  if (!first) return [];
  if (budgetTokens <= 0) return [first];
  if (estimateMessageTokens(first) >= budgetTokens) {
    return [{ role: first.role, content: first.content.slice(0, charsForTokens(budgetTokens)) }];
  }

  const marker: TranscriptEntry = {
    role: "user",
    content: "smith$ # context truncated\nEarlier terminal transcript omitted to preserve the active user request."
  };
  const remainingBudget = budgetTokens - estimateMessageTokens(first) - estimateMessageTokens(marker);
  if (remainingBudget <= 0) return [{ role: first.role, content: first.content.slice(0, charsForTokens(budgetTokens)) }];

  const tail: TranscriptEntry[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 1; index -= 1) {
    const message = messages[index];
    const cost = estimateMessageTokens(message);
    if (used + cost > remainingBudget) break;
    tail.unshift(message);
    used += cost;
  }
  return [first, marker, ...tail];
}

function redactTranscriptActions(transcript: string): {
  transcript: string;
  redactedActions: number;
} {
  const entries = splitTranscript(transcript);
  const protectedEntries = latestActionEntryIndexes(entries);
  const compacted: string[] = [];
  let pendingReason: ParsedToolReason | undefined;
  let redactedActions = 0;
  let hasCompactionNotice = false;

  const flushPendingReason = (): void => {
    if (!pendingReason) return;
    compacted.push(formatCompactedAction(pendingReason.name, pendingReason.reason));
    pendingReason = undefined;
    redactedActions += 1;
  };

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (protectedEntries.has(index)) {
      flushPendingReason();
      compacted.push(entry);
      continue;
    }

    if (isContextCompactedEntry(entry)) {
      hasCompactionNotice = true;
      pendingReason = undefined;
      continue;
    }

    if (isCompactedActionEntry(entry)) {
      flushPendingReason();
      compacted.push(entry);
      continue;
    }

    const reason = parseToolReasonEntry(entry);
    if (reason) {
      flushPendingReason();
      pendingReason = reason;
      continue;
    }

    if (isActionResultObservation(entry)) {
      flushPendingReason();
      redactedActions += 1;
      continue;
    }

    const terminal = parseTerminalEntry(entry);
    if (terminal) {
      const action = pendingReason ?? inferActionFromCommand(terminal.command);
      compacted.push(formatCompactedAction(action.name, action.reason));
      pendingReason = undefined;
      redactedActions += 1;
      continue;
    }

    flushPendingReason();
    compacted.push(entry);
  }

  flushPendingReason();
  if (redactedActions > 0 || hasCompactionNotice) compacted.push(CONTEXT_COMPACTED_ENTRY);
  return { transcript: compacted.join("\n"), redactedActions };
}

function removeOldestCompactedActions(
  transcript: string,
  systemPrompt: string,
  targetTokens: number
): { transcript: string; removedActions: number } {
  const entries = splitTranscript(transcript);
  let current = transcript;
  let removedActions = 0;

  for (let index = 0; index < entries.length; index += 1) {
    if (estimateTranscriptContextTokens(systemPrompt, current) <= targetTokens) break;
    if (!isCompactedActionEntry(entries[index])) continue;
    entries.splice(index, 1);
    index -= 1;
    removedActions += 1;
    current = entries.join("\n");
  }

  if (removedActions > 0 && !entries.some(isContextCompactedEntry)) {
    entries.push(CONTEXT_COMPACTED_ENTRY);
    current = entries.join("\n");
  }

  return { transcript: current, removedActions };
}

function estimateMessagesTokens(messages: TranscriptEntry[]): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

function estimateMessageTokens(message: TranscriptEntry): number {
  return estimateTextTokens(message.content) + MESSAGE_TOKEN_OVERHEAD;
}

function estimateTextTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.max(1, Math.ceil(text.length / TOKEN_CHARS));
}

function charsForTokens(tokens: number): number {
  return Math.max(0, tokens * TOKEN_CHARS);
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
    entry.startsWith(CONTEXT_COMPACTED_PREFIX) ||
    entry.startsWith(COMPACTED_ACTION_PREFIX) ||
    entry.startsWith("smith$ # context truncated") ||
    entry.startsWith("smith$ # recent terminal transcript") ||
    entry.startsWith("smith$ # tool reason") ||
    entry.startsWith("smith$ # timeout")
  );
}

function parseTerminalEntry(entry: string): { command: string; output: string } | undefined {
  if (!entry.startsWith("smith$ ")) return undefined;
  if (isUserTranscriptEntry(entry)) return undefined;
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

type ParsedToolReason = {
  name: string;
  reason?: string;
};

function splitTranscript(transcript: string): string[] {
  return transcript.split(/\n(?=smith\$ )/).filter((entry) => entry.length > 0);
}

function parseToolReasonEntry(entry: string): ParsedToolReason | undefined {
  if (!entry.startsWith("smith$ # tool reason\n")) return undefined;
  const body = entry.slice("smith$ # tool reason\n".length).trim();
  const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*([\s\S]*)$/.exec(body);
  if (!match) return { name: "tool", reason: compactReason(body) };
  return { name: match[1], reason: compactReason(match[2]) };
}

function inferActionFromCommand(command: string): ParsedToolReason {
  if (command === "patch") return { name: "patch" };
  if (command === "finish") return { name: "finish" };
  if (command.startsWith("sub_agent ")) return { name: "sub_agent" };
  if (command.startsWith("# ")) return { name: command.slice(2).replace(/\s+/g, "_") || "observation" };
  return { name: "run" };
}

function formatCompactedAction(name: string, reason: string | undefined): string {
  const compactedReason = compactReason(reason);
  return compactedReason ? `${COMPACTED_ACTION_PREFIX}\n${name}: ${compactedReason}` : `${COMPACTED_ACTION_PREFIX}\n${name}`;
}

function compactReason(reason: string | undefined): string | undefined {
  const compact = reason?.replace(/\s+/g, " ").trim();
  if (!compact) return undefined;
  return compact.length > 500 ? `${compact.slice(0, 497)}...` : compact;
}

function isCompactedActionEntry(entry: string): boolean {
  return entry.startsWith(COMPACTED_ACTION_PREFIX);
}

function isContextCompactedEntry(entry: string): boolean {
  return entry.startsWith(CONTEXT_COMPACTED_PREFIX) || entry.startsWith("smith$ # transcript compacted");
}

function isActionResultObservation(entry: string): boolean {
  return entry.startsWith("smith$ # timeout");
}

function latestActionEntryIndexes(entries: string[]): Set<number> {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (!isRedactableActionEntry(entries[index])) continue;
    const protectedEntries = new Set<number>([index]);
    if (index > 0 && parseToolReasonEntry(entries[index - 1])) protectedEntries.add(index - 1);
    return protectedEntries;
  }
  return new Set();
}

function isRedactableActionEntry(entry: string): boolean {
  return Boolean(parseTerminalEntry(entry)) || isActionResultObservation(entry);
}
