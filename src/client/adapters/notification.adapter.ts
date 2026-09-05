
import type { NotificationPort, NotificationPermission } from "../ports/notificationPort"

export const notificationAdapter: NotificationPort = {
  isSupported(): boolean {
    return typeof Notification !== "undefined"
  },

  getPermission(): NotificationPermission {
    if (typeof Notification === "undefined") return "default"
    return Notification.permission
  },

  async requestPermission(): Promise<NotificationPermission> {
    if (typeof Notification === "undefined") return "default"
    return Notification.requestPermission()
  },
}
