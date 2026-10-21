import { PROTOCOL_VERSION } from "../shared/types"
import type { ClientCommand, CommandResult, NoResultClientCommand, ServerEnvelope } from "../shared/protocol"

export function ackResult<C extends NoResultClientCommand>(id: string, command: C): ServerEnvelope
export function ackResult<C extends ClientCommand>(id: string, command: C, result: CommandResult<C>): ServerEnvelope
export function ackResult(id: string, _command: ClientCommand, result?: CommandResult<ClientCommand>): ServerEnvelope {
  return { v: PROTOCOL_VERSION, type: "ack", id, result }
}
