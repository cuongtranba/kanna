import type { ClientCommand, CommandResult } from "../../shared/protocol"
import type { JsonValue } from "../../shared/json"

export type CommandReply<C extends ClientCommand> = CommandResult<C, JsonValue>

export interface CommandPort {
  command<C extends ClientCommand>(command: C): Promise<CommandReply<C>>
  command<TResult = JsonValue>(command: ClientCommand): Promise<TResult>
}
