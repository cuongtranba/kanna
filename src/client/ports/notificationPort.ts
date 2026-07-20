/**
 * NotificationPort — typed interface for the browser Notification API.
 *
 * Used by pushClient.ts (permission detection and subscription).
 * The concrete implementation is src/client/adapters/notification.adapter.ts.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

export type NotificationPermission = "default" | "granted" | "denied"

export interface NotificationPort {
  /** Returns the current Notification.permission value, or "default" if unsupported. */
  getPermission(): NotificationPermission
  /** Calls Notification.requestPermission() and returns the result. */
  requestPermission(): Promise<NotificationPermission>
  /** Returns true if the Notification API is available in the current context. */
  isSupported(): boolean
}
