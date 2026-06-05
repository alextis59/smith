#!/usr/bin/env node
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const jsonOutput = args.includes("--json");
const file = args.find((arg) => !arg.startsWith("-"));

if (!file || args.includes("--help") || args.includes("-h")) {
  console.error("Usage: node scripts/analyze-provider-debug.mjs [--json] <trace.provider-debug.jsonl>");
  process.exit(file ? 0 : 1);
}

const records = readJsonl(file);
const calls = pairCalls(records);
const analyses = analyzeCalls(calls);
const summary = summarize(analyses);

if (jsonOutput) {
  console.log(JSON.stringify({ file, records: records.length, calls: calls.length, summary, calls: analyses }, null, 2));
} else {
  printTextReport(file, records.length, calls.length, summary, analyses);
}

function readJsonl(path) {
  const text = readFileSync(path, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`failed to parse JSONL line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function pairCalls(records) {
  const calls = [];
  for (const record of records) {
    if (!isRecord(record)) continue;
    if (record.direction === "request") {
      calls.push({ call: calls.length + 1, request: record });
    } else if (record.direction === "response") {
      const pending = calls.findLast((call) => !call.response);
      if (pending) {
        pending.response = record;
      } else {
        calls.push({ call: calls.length + 1, response: record });
      }
    }
  }
  return calls;
}

function analyzeCalls(calls) {
  const results = [];
  let previousMessageCall;

  for (const call of calls) {
    const body = requestBody(call.request);
    const bodyJson = typeof call.request?.body_json === "string" ? call.request.body_json : JSON.stringify(body ?? {});
    const inputItems = normalizeInput(body?.input);
    const logicalMessages = JSON.stringify({
      instructions: typeof body?.instructions === "string" ? body.instructions : "",
      input: inputItems
    });
    const messageComparable = inputItems.length > 0 && inputItems.every((item) => item.kind !== "unknown");
    const status = numericValue(call.response?.status);
    const ok = call.response?.ok === true || (status !== undefined && status >= 200 && status < 300);
    const usage = responseUsage(call.response);
    const requestPromptCacheKey = stringValue(body?.prompt_cache_key);
    const responsePromptCacheKey = responseStringKey(call.response, "prompt_cache_key");
    const previousResponseId = stringValue(body?.previous_response_id);
    const comparison =
      previousMessageCall && messageComparable
        ? compareWithPrevious(previousMessageCall, { bodyJson, inputItems, logicalMessages, usage })
        : undefined;
    const notes = [];

    if (previousResponseId) notes.push("sent previous_response_id");
    if (status && status >= 400) notes.push(responseError(call.response) ?? `response ${status}`);
    if (comparison?.inputPrefixExact) notes.push("input is append-only");
    if (comparison && !comparison.inputPrefixExact) {
      notes.push(`input prefix changed at item ${comparison.inputPrefixItems + 1}`);
    }
    if (
      comparison?.inputPrefixExact &&
      usage?.cachedInputTokens === 0 &&
      comparison.estimatedBodyPrefixTokens !== undefined &&
      comparison.estimatedBodyPrefixTokens >= 1024
    ) {
      notes.push(`zero cached despite ~${comparison.estimatedBodyPrefixTokens} body-prefix tokens`);
    }
    if (requestPromptCacheKey && responsePromptCacheKey && requestPromptCacheKey !== responsePromptCacheKey) {
      notes.push("response cache key differs");
    }

    const result = {
      call: call.call,
      status,
      ok,
      inputKind: inputItems.map((item) => item.kind).join(","),
      inputItems: inputItems.length,
      bodyJsonChars: bodyJson.length,
      logicalMessageChars: logicalMessages.length,
      requestPromptCacheKey,
      responsePromptCacheKey,
      promptCacheKeyMatches:
        requestPromptCacheKey && responsePromptCacheKey ? requestPromptCacheKey === responsePromptCacheKey : undefined,
      previousResponseId,
      usage,
      comparison,
      notes
    };

    results.push(result);
    if (ok && messageComparable && !previousResponseId) {
      previousMessageCall = {
        call: call.call,
        bodyJson,
        inputItems,
        logicalMessages,
        usage
      };
    }
  }

  return results;
}

function compareWithPrevious(previous, current) {
  const bodyPrefixChars = commonPrefixLength(previous.bodyJson, current.bodyJson);
  const logicalMessagePrefixChars = commonPrefixLength(previous.logicalMessages, current.logicalMessages);
  const inputPrefixItems = commonPrefixItems(previous.inputItems, current.inputItems);
  const inputPrefixExact = inputPrefixItems === previous.inputItems.length;
  const firstChangedItem =
    inputPrefixItems < previous.inputItems.length && inputPrefixItems < current.inputItems.length
      ? {
          index: inputPrefixItems,
          previousKind: previous.inputItems[inputPrefixItems].kind,
          currentKind: current.inputItems[inputPrefixItems].kind,
          commonChars: commonPrefixLength(previous.inputItems[inputPrefixItems].fingerprint, current.inputItems[inputPrefixItems].fingerprint)
        }
      : undefined;

  return {
    previousCall: previous.call,
    bodyPrefixChars,
    bodyPrefixPercentOfPrevious: percent(bodyPrefixChars, previous.bodyJson.length),
    logicalMessagePrefixChars,
    logicalMessagePrefixPercentOfPrevious: percent(logicalMessagePrefixChars, previous.logicalMessages.length),
    inputPrefixItems,
    previousInputItems: previous.inputItems.length,
    inputPrefixExact,
    firstChangedItem,
    estimatedBodyPrefixTokens: estimateTokens(bodyPrefixChars, current.bodyJson.length, current.usage?.inputTokens),
    estimatedLogicalMessagePrefixTokens: estimateTokens(
      logicalMessagePrefixChars,
      current.logicalMessages.length,
      current.usage?.inputTokens
    )
  };
}

function summarize(results) {
  const successful = results.filter((result) => result.ok && result.usage);
  const comparable = results.filter((result) => result.comparison);
  const appendOnly = comparable.filter((result) => result.comparison?.inputPrefixExact);
  const zeroCachedAppendOnly = appendOnly.filter((result) => result.usage?.cachedInputTokens === 0);
  const keyMismatches = results.filter((result) => result.promptCacheKeyMatches === false);
  const statefulFailures = results.filter(
    (result) => result.previousResponseId && result.status !== undefined && result.status >= 400
  );

  return {
    successfulCalls: successful.length,
    comparableCalls: comparable.length,
    appendOnlyComparableCalls: appendOnly.length,
    zeroCachedAppendOnlyCalls: zeroCachedAppendOnly.map((result) => result.call),
    promptCacheKeyMismatchCalls: keyMismatches.map((result) => result.call),
    statefulFailureCalls: statefulFailures.map((result) => result.call),
    inputTokens: sum(successful.map((result) => result.usage?.inputTokens)),
    cachedInputTokens: sum(successful.map((result) => result.usage?.cachedInputTokens)),
    outputTokens: sum(successful.map((result) => result.usage?.outputTokens)),
    reasoningOutputTokens: sum(successful.map((result) => result.usage?.reasoningOutputTokens)),
    totalTokens: sum(successful.map((result) => result.usage?.totalTokens))
  };
}

function printTextReport(file, recordCount, callCount, summary, results) {
  console.log(`Provider debug prefix analysis`);
  console.log(`File: ${file}`);
  console.log(`Records: ${recordCount}`);
  console.log(`Calls: ${callCount}`);
  console.log(
    `Usage: input ${formatInt(summary.inputTokens)}, cached ${formatInt(summary.cachedInputTokens)} (${formatPercent(
      summary.cachedInputTokens,
      summary.inputTokens
    )}), output ${formatInt(summary.outputTokens)}, reasoning ${formatInt(summary.reasoningOutputTokens)}, total ${formatInt(
      summary.totalTokens
    )}`
  );
  console.log(
    `Comparable message calls: ${summary.comparableCalls}; append-only prefixes: ${summary.appendOnlyComparableCalls}; zero cached despite append-only prefix: ${
      summary.zeroCachedAppendOnlyCalls.length ? summary.zeroCachedAppendOnlyCalls.join(", ") : "none"
    }`
  );
  console.log(
    `Prompt cache key mismatches: ${
      summary.promptCacheKeyMismatchCalls.length ? summary.promptCacheKeyMismatchCalls.join(", ") : "none"
    }; stateful failures: ${summary.statefulFailureCalls.length ? summary.statefulFailureCalls.join(", ") : "none"}`
  );
  console.log("");
  console.log(
    [
      "call",
      "status",
      "items",
      "prev",
      "prefix_items",
      "body_prefix",
      "body_est_tok",
      "msg_prefix",
      "msg_est_tok",
      "input",
      "cached",
      "cache%",
      "key",
      "notes"
    ].join("\t")
  );
  for (const result of results) {
    const comparison = result.comparison;
    console.log(
      [
        result.call,
        result.status ?? "-",
        result.inputItems,
        comparison?.previousCall ?? "-",
        comparison ? `${comparison.inputPrefixItems}/${comparison.previousInputItems}` : "-",
        comparison
          ? `${formatInt(comparison.bodyPrefixChars)} (${formatNumber(comparison.bodyPrefixPercentOfPrevious)}%)`
          : "-",
        comparison?.estimatedBodyPrefixTokens ?? "-",
        comparison
          ? `${formatInt(comparison.logicalMessagePrefixChars)} (${formatNumber(
              comparison.logicalMessagePrefixPercentOfPrevious
            )}%)`
          : "-",
        comparison?.estimatedLogicalMessagePrefixTokens ?? "-",
        result.usage?.inputTokens ?? "-",
        result.usage?.cachedInputTokens ?? "-",
        result.usage ? formatPercent(result.usage.cachedInputTokens, result.usage.inputTokens) : "-",
        result.promptCacheKeyMatches === undefined ? "-" : result.promptCacheKeyMatches ? "match" : "diff",
        result.notes.join("; ")
      ].join("\t")
    );
  }
  console.log("");
  console.log(
    "Token estimates are approximate. They scale exact common-prefix characters by the provider-reported input tokens for the current call; use them to spot large contradictions, not as exact tokenizer counts."
  );
}

function requestBody(record) {
  if (!isRecord(record)) return undefined;
  if (isRecord(record.body)) return record.body;
  if (typeof record.body_json === "string") {
    try {
      const parsed = JSON.parse(record.body_json);
      return isRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function normalizeInput(input) {
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    if (!isRecord(item)) return normalizeUnknown(item);
    if (item.type === "function_call_output") {
      return {
        kind: "function_call_output",
        role: "tool",
        text: stringValue(item.output) ?? "",
        fingerprint: JSON.stringify({
          type: "function_call_output",
          call_id: stringValue(item.call_id) ?? "",
          output: stringValue(item.output) ?? ""
        })
      };
    }
    const role = stringValue(item.role) ?? stringValue(item.type) ?? "unknown";
    const parts = Array.isArray(item.content)
      ? item.content.map((part) => normalizeContentPart(part))
      : [{ type: "text", text: stringValue(item.content) ?? "" }];
    const normalized = { role, parts };
    return {
      kind: role,
      role,
      text: parts.map((part) => part.text).join(""),
      fingerprint: JSON.stringify(normalized)
    };
  });
}

function normalizeContentPart(part) {
  if (!isRecord(part)) return { type: "unknown", text: stringValue(part) ?? "" };
  return {
    type: stringValue(part.type) ?? "unknown",
    text: stringValue(part.text) ?? ""
  };
}

function normalizeUnknown(value) {
  return {
    kind: "unknown",
    role: "unknown",
    text: stringValue(value) ?? "",
    fingerprint: JSON.stringify(value)
  };
}

function responseUsage(record) {
  const response = completedResponse(record);
  const usage = isRecord(response?.usage) ? response.usage : undefined;
  if (!usage) return undefined;
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : undefined;
  const outputDetails = isRecord(usage.output_tokens_details) ? usage.output_tokens_details : undefined;
  return {
    inputTokens: numericValue(usage.input_tokens),
    cachedInputTokens: numericValue(inputDetails?.cached_tokens) ?? 0,
    outputTokens: numericValue(usage.output_tokens),
    reasoningOutputTokens: numericValue(outputDetails?.reasoning_tokens) ?? 0,
    totalTokens: numericValue(usage.total_tokens)
  };
}

function completedResponse(record) {
  if (!isRecord(record) || !Array.isArray(record.events)) return undefined;
  for (let index = record.events.length - 1; index >= 0; index -= 1) {
    const event = record.events[index];
    if (isRecord(event) && event.type === "response.completed" && isRecord(event.response)) {
      return event.response;
    }
  }
  return undefined;
}

function responseStringKey(record, key) {
  const response = completedResponse(record);
  return findStringKey(response, key);
}

function responseError(record) {
  if (!isRecord(record)) return undefined;
  const errorJson = isRecord(record.error_json) ? record.error_json : undefined;
  const error = isRecord(errorJson?.error) ? errorJson.error : errorJson;
  return stringValue(error?.message) ?? stringValue(record.raw_sse)?.trim();
}

function findStringKey(value, key) {
  if (!isRecord(value) && !Array.isArray(value)) return undefined;
  if (isRecord(value) && typeof value[key] === "string") return value[key];
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = findStringKey(child, key);
    if (found) return found;
  }
  return undefined;
}

function commonPrefixItems(previous, current) {
  let count = 0;
  while (
    count < previous.length &&
    count < current.length &&
    previous[count].fingerprint === current[count].fingerprint
  ) {
    count += 1;
  }
  return count;
}

function commonPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left.charCodeAt(index) === right.charCodeAt(index)) index += 1;
  return index;
}

function estimateTokens(prefixChars, totalChars, inputTokens) {
  if (!inputTokens || !totalChars) return undefined;
  return Math.floor(Math.min(inputTokens, (prefixChars / totalChars) * inputTokens));
}

function percent(part, total) {
  if (!total) return 0;
  return (part / total) * 100;
}

function sum(values) {
  return values.reduce((total, value) => total + (value ?? 0), 0);
}

function formatPercent(part, total) {
  return `${formatNumber(percent(part ?? 0, total ?? 0))}%`;
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "-";
}

function formatInt(value) {
  return (value ?? 0).toLocaleString("en-US");
}

function numericValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value) {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
