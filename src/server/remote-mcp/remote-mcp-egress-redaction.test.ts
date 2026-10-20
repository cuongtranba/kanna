import { describe, expect, test } from "bun:test"
import type { ClientCommand, CommandAckResult, ServerEnvelope } from "../../shared/protocol"
import type { LlmProviderSnapshot } from "../../shared/types"
import { PROTOCOL_VERSION } from "../../shared/types"
import { withEgressRedaction } from "./remote-mcp-egress-redaction"

const RAW_API_KEY = "sk-live-llm-provider-key"

const llmProvider: LlmProviderSnapshot = {
  provider: "openai",
  apiKey: RAW_API_KEY,
  model: "gpt-test",
  baseUrl: "",
  resolvedBaseUrl: "https://api.openai.com/v1",
  enabled: true,
  warning: null,
  filePathDisplay: "~/.kanna/llm-provider.json",
}

function hostAnswering(result: CommandAckResult) {
  return withEgressRedaction({
    dispatchCommand: async (_command: ClientCommand): Promise<ServerEnvelope> => ({ v: PROTOCOL_VERSION, type: "ack", id: "x", result }),
    readSnapshot: (): ServerEnvelope => ({ v: PROTOCOL_VERSION, type: "error", message: "unused" }),
  })
}

describe("remote MCP egress redaction", () => {
  test("settings.readLlmProvider does not return the raw apiKey", async () => {
    const envelope = await hostAnswering(llmProvider).dispatchCommand({ type: "settings.readLlmProvider" })

    expect(JSON.stringify(envelope)).not.toContain(RAW_API_KEY)
    expect(envelope).toMatchObject({ type: "ack", result: { provider: "openai", model: "gpt-test", enabled: true } })
  })

  test("a share token and a beacon pairing code a caller asked for are not masked", async () => {
    const minted = await hostAnswering({ ok: true, token: "share-token-abc", url: "https://kanna.example/s/share-token-abc" })
      .dispatchCommand({ type: "share.mint", payload: { chatId: "chat-1" } })
    const pairing = await hostAnswering({ ok: true, code: "PAIR-1234", token: "pairing-token-xyz" })
      .dispatchCommand({ type: "beacons.mintPairingCode" })

    expect(minted).toMatchObject({ result: { token: "share-token-abc", url: "https://kanna.example/s/share-token-abc" } })
    expect(pairing).toMatchObject({ result: { code: "PAIR-1234", token: "pairing-token-xyz" } })
  })
})
