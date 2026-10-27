import { useCallback } from "react"
import { usePushSettingsStore } from "../stores/pushSettingsStore"
import type { KannaState } from "./useKannaState"
import {
  clearStoredPushDeviceId,
  detectPushSupport,
  setStoredPushDeviceId,
  subscribePush,
  unsubscribePush,
} from "./pushClient"

export function usePushDeviceActions(state: Pick<KannaState, "pushConfig" | "socket">) {
  const { pushConfig, socket } = state
  const pushDeviceId = usePushSettingsStore((s) => s.deviceId)
  const setPushDeviceId = usePushSettingsStore((s) => s.setDeviceId)
  const setPushPermissionState = usePushSettingsStore((s) => s.setPermissionState)

  const handleEnablePush = useCallback(async () => {
    if (!pushConfig) return
    try {
      const id = await subscribePush({
        vapidPublicKey: pushConfig.vapidPublicKey,
        sendToServer: async (payload) => {
          const result = await socket.command({
            type: "push.subscribe",
            subscription: payload.subscription,
            label: payload.label,
            userAgent: payload.userAgent,
          })
          setStoredPushDeviceId(result.id)
          return { id: result.id }
        },
      })
      setPushDeviceId(id)
    } finally {
      setPushPermissionState(detectPushSupport().state)
    }
  }, [pushConfig, socket, setPushDeviceId, setPushPermissionState])

  const handleDisablePush = useCallback(async () => {
    if (!pushDeviceId) return
    await unsubscribePush({
      pushDeviceId,
      sendToServer: async (id) => {
        await socket.command({ type: "push.unsubscribe", pushDeviceId: id })
      },
    })
    clearStoredPushDeviceId()
    setPushDeviceId(null)
  }, [pushDeviceId, socket, setPushDeviceId])

  return { handleEnablePush, handleDisablePush }
}
