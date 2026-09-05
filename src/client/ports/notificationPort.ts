
export type NotificationPermission = "default" | "granted" | "denied"

export interface NotificationPort {
  getPermission(): NotificationPermission
  requestPermission(): Promise<NotificationPermission>
  isSupported(): boolean
}
