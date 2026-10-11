import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { ServerEnvelope } from "../../shared/protocol"
import type { RemoteMcpHost } from "./remote-mcp-server"

const JSON_MIME_TYPE = "application/json"
const CHAT_RECENT_LIMIT = 50

function snapshotJson(envelope: ServerEnvelope): string {
  return JSON.stringify(envelope.type === "snapshot" ? envelope.snapshot.data : envelope)
}

function firstVariable(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "")
}

export function registerKannaResources(server: McpServer, host: RemoteMcpHost): void {
  server.registerResource(
    "projects",
    "kanna://projects",
    { title: "Projects", description: "Every project group in the Kanna sidebar, with its chats.", mimeType: JSON_MIME_TYPE },
    (uri) => {
      const envelope = host.readSnapshot({ type: "sidebar" })
      const data = envelope.type === "snapshot" && envelope.snapshot.type === "sidebar" ? envelope.snapshot.data : null
      const text = data
        ? JSON.stringify({ starredProjectGroups: data.starredProjectGroups, projectGroups: data.projectGroups })
        : snapshotJson(envelope)
      return { contents: [{ uri: uri.href, mimeType: JSON_MIME_TYPE, text }] }
    },
  )

  server.registerResource(
    "chat",
    new ResourceTemplate("kanna://chats/{chatId}", { list: undefined }),
    { title: "Chat", description: "The recent transcript and state of one chat.", mimeType: JSON_MIME_TYPE },
    (uri, variables) => {
      const chatId = firstVariable(variables.chatId)
      const envelope = host.readSnapshot({ type: "chat", chatId, recentLimit: CHAT_RECENT_LIMIT })
      return { contents: [{ uri: uri.href, mimeType: JSON_MIME_TYPE, text: snapshotJson(envelope) }] }
    },
  )

  server.registerResource(
    "board",
    new ResourceTemplate("kanna://boards/{boardId}", { list: undefined }),
    { title: "Board", description: "A kanban board with its columns and cards.", mimeType: JSON_MIME_TYPE },
    (uri, variables) => {
      const boardId = firstVariable(variables.boardId)
      const envelope = host.readSnapshot({ type: "board", boardId })
      return { contents: [{ uri: uri.href, mimeType: JSON_MIME_TYPE, text: snapshotJson(envelope) }] }
    },
  )
}
