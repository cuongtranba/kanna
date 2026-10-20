import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientCommand, CommandResult, ServerEnvelope } from "../shared/protocol"

export function ackResult<C extends ClientCommand>(id: string, _command: C, result: CommandResult<C>): ServerEnvelope {
  return { v: PROTOCOL_VERSION, type: "ack", id, result }
}
