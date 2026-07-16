/**
 * src/client/ports/index.ts — Client ports barrel.
 *
 * Re-exports every typed port interface. Adapters (*.adapter.ts files in
 * src/client/adapters/) implement these interfaces; stores and components
 * consume them via injection or the default adapter singleton.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

export type { HttpPort, HttpRequestOptions, HttpResponse } from "./httpPort"
export type { StoragePort } from "./storagePort"
export type { TimerPort } from "./timerPort"
export type { DomPort } from "./domPort"
export type { NotificationPort, NotificationPermission } from "./notificationPort"
export type { SoundPort } from "./soundPort"
export type { ClipboardPort } from "./clipboardPort"
