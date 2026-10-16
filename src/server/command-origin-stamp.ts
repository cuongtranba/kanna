import type { CommandOrigin } from "../shared/command-origin"
import type { ClientCommand } from "../shared/protocol"

export function stampCommandOrigin(command: ClientCommand, origin: CommandOrigin | undefined): ClientCommand {
  if (command.type !== "chat.send" && command.type !== "message.enqueue") return command
  const { origin: _claimed, ...unlabelled } = command
  return origin === undefined ? unlabelled : { ...unlabelled, origin }
}
