import type { ProfileConfig, RuntimeConfig } from "./config.js";
import { completeWithProfile, type ProviderFetch } from "./providers/index.js";

export type DangerReviewResult = {
  allowed: boolean;
  reason?: string;
};

const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(?:-[^\s]*[rf][^\s]*\s+){0,2}(?:\/|~|\$HOME)(?:\s|$)/, reason: "destructive rm target" },
  { pattern: /\bsudo\b/, reason: "privileged command" },
  { pattern: /\b(?:curl|wget)\b[\s\S]*\|\s*(?:sh|bash|zsh)\b/, reason: "downloaded script execution" },
  { pattern: /\bmkfs(?:\.[a-z0-9]+)?\b|\bdd\b[\s\S]*\bof=\/dev\//, reason: "disk formatting or raw disk write" },
  { pattern: /(?:^|\s)(?:cat|sed|awk|grep|rg|less|more|tail|head)\b[\s\S]*(?:\.ssh\/|id_rsa|id_ed25519|\.gnupg|\.aws\/credentials|\.env\b)/, reason: "credential file access" },
  { pattern: /\b(?:printenv|env|export\s+-p)\b[\s\S]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AWS_|OPENAI_|ANTHROPIC_|GEMINI_)/i, reason: "credential environment access" }
];

export function detectDangerousCommand(command: string): string | undefined {
  const normalized = command.replace(/\s+/g, " ").trim();
  return DANGEROUS_PATTERNS.find((item) => item.pattern.test(normalized))?.reason;
}

export async function reviewDangerousCommand(options: {
  command: string;
  cwd: string;
  recentTranscript: string;
  runtime: RuntimeConfig;
  reviewerProfile?: ProfileConfig;
  env?: NodeJS.ProcessEnv;
  fetch?: ProviderFetch;
}): Promise<DangerReviewResult> {
  if (options.runtime.dangerReview === "off") return { allowed: true };
  const reason = detectDangerousCommand(options.command);
  if (!reason) return { allowed: true };

  if (options.runtime.dangerReview === "ask") {
    return { allowed: false, reason };
  }

  if (!options.reviewerProfile) {
    return { allowed: false, reason: "reviewer profile is not configured" };
  }

  const response = await completeWithProfile(
    {
      model: options.reviewerProfile.model,
      messages: [
        {
          role: "system",
          content:
            "You are Smith's narrow command danger reviewer. Reply with exactly ALLOW or BLOCK. Block destructive commands, privilege escalation, downloaded script execution, disk formatting, and credential-seeking commands. Do not block ordinary coding commands."
        },
        {
          role: "user",
          content: `Working directory: ${options.cwd}
Matched reason: ${reason}
Command:
${options.command}

Recent transcript:
${options.recentTranscript.slice(-4000)}`
        }
      ],
      temperature: 0,
      maxOutputTokens: 16
    },
    options.reviewerProfile,
    { env: options.env, fetch: options.fetch }
  );

  return response.text.trim().toUpperCase().startsWith("ALLOW")
    ? { allowed: true }
    : { allowed: false, reason };
}
