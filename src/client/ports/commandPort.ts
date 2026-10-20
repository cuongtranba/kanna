import type { JsonValue } from "../../shared/json"
import type { ClientCommand } from "../../shared/protocol"

export interface CommandPort {
  command(command: ClientCommand): Promise<JsonValue>
}
