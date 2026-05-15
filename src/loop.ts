import type { ProfileConfig, RuntimeConfig } from "./config.js";
import { completeWithProfile, type ProviderFetch } from "./providers/index.js";
import { PtyShellRunner } from "./pty.js";
import { appendChatIn, appendTerminalTurn, transcriptToMessages } from "./transcript.js";

export type RunMode = "single" | "remote" | "interactive";

export type SmithRunOptions = {
  cwd: string;
  prompt: string;
  initialTranscript?: string;
  profile: ProfileConfig;
  runtime: RuntimeConfig;
  systemPrompt: string;
  maxTurns?: number;
  env?: NodeJS.ProcessEnv;
  fetch?: ProviderFetch;
  onTerminalOutput?: (output: string) => void;
  onModelOutput?: (output: string) => void;
};

export type SmithRunResult = {
  chatOut: string;
  turns: number;
  transcript: string;
};

export async function runSmithTask(options: SmithRunOptions): Promise<SmithRunResult> {
  const maxTurns = options.maxTurns ?? 20;
  let transcript = options.initialTranscript ?? appendChatIn(options.prompt);
  const shell = await PtyShellRunner.start({
    cwd: options.cwd,
    shell: options.runtime.shell,
    timeoutMs: options.runtime.timeoutMs,
    env: options.env
  });

  try {
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const response = await completeWithProfile(
        {
          model: options.profile.model,
          messages: transcriptToMessages(options.systemPrompt, transcript, options.runtime.maxContextChars)
        },
        options.profile,
        { env: options.env, fetch: options.fetch }
      );
      options.onModelOutput?.(response.text);
      const result = await shell.run(response.text, options.runtime.timeoutMs);
      transcript = appendTerminalTurn(transcript, result.command, result.output);
      if (result.output) options.onTerminalOutput?.(result.output);
      if (result.chatOut !== undefined) {
        return { chatOut: result.chatOut, turns: turn, transcript };
      }
      if (result.timedOut) {
        transcript = appendTerminalTurn(transcript, "# timeout", "Command timed out");
      }
    }
  } finally {
    shell.kill();
  }

  throw new Error(`model did not call chat_out within ${maxTurns} turns`);
}
