import { useMemo } from "react"
import {
  decodeDatasetQueryOutcome,
  jsonObjectSchema,
  type DatasetDecl,
  type DatasetQuery,
  type DatasetQueryOutcome,
} from "../../../shared/genui"
import type { JsonObject } from "../../../shared/json"
import { domAdapter } from "../../adapters/dom.adapter"
import { useOptionalKannaSocket } from "../../app/KannaSocketProvider"
import type { GenUIHost } from "./host"

function toJsonObject(value: DatasetDecl | DatasetQuery): JsonObject {
  const parsed = jsonObjectSchema.safeParse(value)
  if (!parsed.success) throw new Error("The view's data description is not plain JSON")
  return parsed.data
}

const UNEXPECTED: DatasetQueryOutcome = { status: "error", code: "source_unavailable", message: "The server sent an unexpected response" }

export function useChatGenUIHost(chatId: string | null, workspaceRoot: string | null): GenUIHost {
  const socket = useOptionalKannaSocket()
  return useMemo((): GenUIHost => {
    const live = socket !== null && chatId !== null
    return {
      chatId,
      readonly: !live,
      workspaceRoot,
      queryDataset: live
        ? async (decl, query, refresh) => {
            const raw = await socket.command({ type: "genui.dataset.query", chatId, dataset: toJsonObject(decl), query: toJsonObject(query), refresh })
            return decodeDatasetQueryOutcome(raw) ?? UNEXPECTED
          }
        : null,
      approveTool: live
        ? async (server, tool) => {
            await socket.command({ type: "genui.dataset.approve", chatId, server, tool })
          }
        : null,
      sendToAgent: live
        ? async (content) => {
            await socket.command({ type: "chat.send", chatId, content })
          }
        : null,
      openLink: (url) => domAdapter.openWindow(url, "_blank", "noopener,noreferrer"),
      ChartRenderer: null,
      FlowRenderer: null,
    }
  }, [chatId, socket, workspaceRoot])
}
