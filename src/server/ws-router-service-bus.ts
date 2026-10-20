import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import { ackResult } from "./ws-router-ack"
import type { ServiceBusController } from "./service-bus/service-bus-boot"

export async function handleServiceBusCommand(
  serviceBus: Pick<ServiceBusController, "resetStore"> | undefined,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  if (command.type !== "serviceBus.resetStore") return false
  if (!serviceBus) throw new Error("The service bus is not available on this server")
  await serviceBus.resetStore()
  send(ackResult(id, command, { ok: true }))
  return true
}
