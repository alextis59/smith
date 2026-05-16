import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

export type ParsedProviderEvent = {
  type: string;
  itemType?: string;
  name?: string;
  text?: string;
};

export type TraceSummary = {
  modelOutputs: string[];
  terminalOutputs: string[];
  parsedEvents: ParsedProviderEvent[];
  chatOut?: string;
};

export function configuredLogDir(cliValue: string | undefined, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return cliValue ?? env.SMITH_LOG_DIR;
}

export function writeSessionLog(logDir: string | undefined, prefix: string, payload: Record<string, unknown>): string | undefined {
  if (!logDir) return undefined;
  mkdirSync(logDir, { recursive: true });
  const path = join(logDir, `${timestamp()}-${safeName(prefix)}.json`);
  writeFileSync(path, `${JSON.stringify(redactLogValue(payload), null, 2)}\n`, "utf8");
  return path;
}

export function summarizeProviderEvents(raw: unknown): ParsedProviderEvent[] {
  if (!Array.isArray(raw)) return [];
  const events: ParsedProviderEvent[] = [];
  for (const event of raw) {
    if (!isRecord(event)) continue;
    const type = stringValue(event.type);
    if (!type) continue;
    if (type.endsWith(".delta")) continue;
    const summary: ParsedProviderEvent = { type };
    if (isRecord(event.item)) {
      summary.itemType = stringValue(event.item.type);
      summary.name = stringValue(event.item.name);
    }
    const text = stringValue(event.delta) ?? stringValue(event.text) ?? stringValue(event.arguments);
    if (text) summary.text = truncate(text, 500);
    events.push(summary);
  }
  return events;
}

export function summarizeTrace(path: string | undefined): TraceSummary {
  if (!path || !existsSync(path)) return { modelOutputs: [], terminalOutputs: [], parsedEvents: [] };
  return summarizeTraceText(readFileSync(path, "utf8"));
}

export function summarizeTraceText(trace: string): TraceSummary {
  const sections = trace.split(/\n(?=## )/);
  const summary: TraceSummary = { modelOutputs: [], terminalOutputs: [], parsedEvents: [] };
  for (const section of sections) {
    const match = /^## ([^\n]+)\n([\s\S]*)$/m.exec(section.trimEnd());
    if (!match) continue;
    const [, name, content] = match;
    if (name === "model output") {
      summary.modelOutputs.push(content);
    } else if (name === "terminal output") {
      summary.terminalOutputs.push(content);
    } else if (name === "chat_out") {
      summary.chatOut = content;
    } else if (name === "parsed events") {
      const parsed = parseJson(content);
      if (Array.isArray(parsed)) {
        summary.parsedEvents.push(...(parsed.filter(isParsedProviderEvent) as ParsedProviderEvent[]));
      }
    }
  }
  return summary;
}

export function redactLogValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactLogValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (/authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|secret|password/i.test(key)) {
        return [key, "[redacted]"];
      }
      return [key, redactLogValue(item)];
    })
  );
}

export function tracePathFromContainerPath(hostHome: string, containerTracePath: string | undefined): string | undefined {
  if (!containerTracePath) return undefined;
  return join(hostHome, ".smith", "runs", basename(containerTracePath));
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeName(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "session";
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isParsedProviderEvent(value: unknown): value is ParsedProviderEvent {
  return isRecord(value) && typeof value.type === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/"(?:access|refresh|id)_token"\s*:\s*"[^"]+"/gi, (match) => match.replace(/"[^"]+"$/, "\"[redacted]\""))
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)=([^\s]+)/g, (match, key: string) =>
      /TOKEN|KEY|SECRET|PASSWORD/i.test(key) ? `${key}=[redacted]` : match
    );
}
