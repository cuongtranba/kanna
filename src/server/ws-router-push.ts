import { PROTOCOL_VERSION } from "../shared/types"
import type { PushSubscribeRequestPayload } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"


export interface PushManagerDep {
  recordDeviceSeen(id: string): Promise<void>
  addSubscription(args: {
    subscription: PushSubscribeRequestPayload
    label: string
    userAgent: string
  }): Promise<{ id: string }>
  removeSubscription(id: string, reason: "user_revoked" | "expired" | "replaced"): Promise<void>
  sendTest(id: string): Promise<void>
  setProjectMute(localPath: string, muted: boolean): Promise<void>
  setChatMute(chatId: string, muted: boolean): Promise<void>
  setFocusedChat(deviceId: string, chatId: string | null): void
}

export interface PushCommandDeps {
  pushManager: PushManagerDep
  getPushDeviceId: () => string | null | undefined
  setPushDeviceId: (id: string | null) => void
  send: (envelope: ServerEnvelope) => void
  broadcastPushConfig: () => Promise<void>
}


export async function handlePushCommand(
  deps: PushCommandDeps,
  command: ClientCommand,
  id: string,
): Promise<boolean> {
  const { pushManager, getPushDeviceId, setPushDeviceId, send, broadcastPushConfig } = deps

  switch (command.type) {
    case "push.identifyDevice": {
      setPushDeviceId(command.pushDeviceId)
      if (command.pushDeviceId) {
        await pushManager.recordDeviceSeen(command.pushDeviceId)
        await broadcastPushConfig()
      }
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "push.subscribe": {
      const result = await pushManager.addSubscription({
        subscription: command.subscription,
        label: command.label,
        userAgent: command.userAgent,
      })
      setPushDeviceId(result.id)
      await broadcastPushConfig()
      send({ v: PROTOCOL_VERSION, type: "ack", id, result })
      return true
    }
    case "push.unsubscribe": {
      await pushManager.removeSubscription(command.pushDeviceId, "user_revoked")
      if (getPushDeviceId() === command.pushDeviceId) {
        setPushDeviceId(null)
      }
      await broadcastPushConfig()
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "push.test": {
      const deviceId = getPushDeviceId()
      if (deviceId) {
        await pushManager.sendTest(deviceId)
      }
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "push.setProjectMute": {
      await pushManager.setProjectMute(command.localPath, command.muted)
      await broadcastPushConfig()
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "push.setChatMute": {
      await pushManager.setChatMute(command.chatId, command.muted)
      await broadcastPushConfig()
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    case "push.setFocusedChat": {
      const deviceId = getPushDeviceId()
      if (deviceId) {
        pushManager.setFocusedChat(deviceId, command.chatId)
      }
      send({ v: PROTOCOL_VERSION, type: "ack", id })
      return true
    }
    default:
      return false
  }
}
