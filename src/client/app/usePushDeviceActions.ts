import { useCallback } from "react"
import { useSettingsPageStore } from "../stores/settingsPageStore"
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
  const pushDeviceId = useSettingsPageStore((s) => s.pushDeviceId)
  const setPushDeviceId = useSettingsPageStore((s) => s.setPushDeviceId)
  const setPushPermissionState = useSettingsPageStore((s) => s.setPushPermissionState)

  const handleEnablePush = useCallback(async () => {
    if (!pushConfig) return
    try {
      const id = await subscribePush({
        vapidPublicKey: pushConfig.vapidPublicKey,
        sendToServer: async (payload) => {
          const result = await socket.command<{ id: string }>({
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
