import { expect, test } from "vite-plus/test"
import type { CommandOrigin } from "./command-origin"
import { commandOriginSchema } from "./command-origin.schema"

const ORIGINS: CommandOrigin[] = [
  { kind: "remote_mcp", clientId: "client-1", clientName: "ChatGPT", via: "oauth", tool: "send_message", callId: "call-1" },
  { kind: "peer_chat", fromChatId: "chat-1", fromTitle: "Backend", fromProjectId: "project-1", fromProjectTitle: "API", messageId: "msg-1" },
]

test("both kinds of origin survive a trip through the schema unchanged", () => {
  for (const origin of ORIGINS) {
    expect(commandOriginSchema.parse(JSON.parse(JSON.stringify(origin)))).toEqual(origin)
  }
})
