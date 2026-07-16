/**
 * notification.adapter.ts — Browser Notification API implementation of NotificationPort.
 *
 * Guards against environments where the Notification API is absent.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

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
