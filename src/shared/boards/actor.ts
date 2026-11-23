import type { CommandOrigin } from "../command-origin"
import type { CardActor } from "./types"

const USER: CardActor = { kind: "user" }

export function cardActorOfOrigin(origin: CommandOrigin | undefined): CardActor {
  if (origin === undefined) return USER
  if (origin.kind === "peer_chat") return { kind: "agent", chatId: origin.fromChatId }
  return {
    kind: "remote_mcp",
    clientId: origin.clientId,
    ...(origin.clientName ? { clientName: origin.clientName } : {}),
  }
}
