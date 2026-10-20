import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import { PROTOCOL_VERSION } from "../shared/types"
import type { ServiceBusController } from "./service-bus/service-bus-boot"

export async function handleServiceBusCommand(
  serviceBus: Pick<ServiceBusController, "resetStore"> | undefined,
  send: (envelope: ServerEnvelope) => void,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  if (!command.type.startsWith("serviceBus.")) return false
  if (!serviceBus) throw new Error("The service bus is not available on this server")
  await serviceBus.resetStore()
  send({ v: PROTOCOL_VERSION, type: "ack", id, result: { ok: true } })
  return true
}
