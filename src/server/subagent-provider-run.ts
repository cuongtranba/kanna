import type { Subagent } from "../shared/types"
import type { ProviderRunStart } from "./subagent-orchestrator"

// TODO(phase3-followup): replace this stub with real provider integration.
// Real implementation requires:
//   1. startClaudeSession() to accept a custom systemPrompt override and an
//      initialPrompt (so the subagent can be one-shot without resume tokens).
//   2. CodexAppServerManager.startSession()/startTurn() to support an
//      ephemeral session that does not write back to chat.sessionTokensByProvider.
//   3. Forwarding HarnessTurn.stream assistant_text fragments to onChunk so the
//      orchestrator emits subagent_message_delta events as they arrive.
//
// For now this stub satisfies the orchestrator contract by echoing the
// subagent's systemPrompt + primer, streamed in chunks so the live-streaming
// UI path can be exercised end-to-end.
export interface BuildSubagentProviderRunArgs {
  subagent: Subagent
  chatId: string
  primer: string | null
  authReady?: () => Promise<boolean>
}

export function buildSubagentProviderRun(args: BuildSubagentProviderRunArgs): ProviderRunStart {
  const { subagent, primer } = args
  const body = primer
    ? `[${subagent.name}] received primer:\n${primer}`
    : `[${subagent.name}] no prior context.`
  const reply = `${body}\n\n(System prompt: ${subagent.systemPrompt})`
  return {
    provider: subagent.provider,
    model: subagent.model,
    systemPrompt: subagent.systemPrompt,
    preamble: primer,
    authReady: args.authReady ?? (async () => true),
    async start(onChunk) {
      const chunks = splitForStream(reply)
      for (const chunk of chunks) {
        onChunk(chunk)
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      return { text: reply }
    },
  }
}

function splitForStream(text: string): string[] {
  if (text.length <= 64) return [text]
  const out: string[] = []
  for (let i = 0; i < text.length; i += 64) out.push(text.slice(i, i + 64))
  return out
}
