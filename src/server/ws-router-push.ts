/**
 * ws-router-push.ts
 *
 * WS command handlers for push-notification lifecycle operations:
 *   push.identifyDevice, push.subscribe, push.unsubscribe,
 *   push.test, push.setProjectMute, push.setFocusedChat
 *
 * Extracted from ws-router.ts.
 */
import { PROTOCOL_VERSION } from "../shared/types"
import type { PushSubscribeRequestPayload } from "../shared/types"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"

// ---------------------------------------------------------------------------
// Dep interfaces (duck-typed; avoids circular imports with ws-router.ts)
// ---------------------------------------------------------------------------

/** The subset of PushManager methods consumed by push WS commands. */
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
  setFocusedChat(deviceId: string, chatId: string | null): void
}

export interface PushCommandDeps {
  /** Push manager for device/subscription operations. */
  pushManager: PushManagerDep
  /** Read the current connection's push device id. */
  getPushDeviceId: () => string | null | undefined
  /** Persist a new device id on the current connection (or null to clear). */
  setPushDeviceId: (id: string | null) => void
  /** Pre-bound to the current WebSocket; called to send an ack envelope. */
  send: (envelope: ServerEnvelope) => void
  /**
   * Broadcast the updated push-config snapshot to all connected clients.
   * Called after any operation that changes subscription or mute state.
   */
  broadcastPushConfig: () => Promise<void>
}

// ---------------------------------------------------------------------------
// Command dispatcher
// ---------------------------------------------------------------------------

/**
 * Handle one push WS command.
 *
 * Returns `true` when the command was handled (caller should `return`).
 * Returns `false` when the command type is outside this module's scope.
 */
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
