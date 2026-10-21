import type { ClientCommand, CommandResult } from "../../shared/protocol"

export type CommandReply<C extends ClientCommand> = CommandResult<C>

export interface CommandPort {
  command<C extends ClientCommand>(command: C): Promise<CommandReply<C>>
}
