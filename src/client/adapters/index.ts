/**
 * src/client/adapters/index.ts — Client adapters barrel.
 *
 * Re-exports every adapter singleton. Each adapter wraps one browser
 * primitive surface and implements its matching port interface from
 * src/client/ports/.
 *
 * NAMING CONVENTION (mirrors the server *.adapter.ts seal):
 *   - Filename suffix `.adapter.ts` is MANDATORY.
 *   - Each file wraps ONE primitive surface (no mixed concerns).
 *   - Adapters have no domain logic — they normalize shape, not behaviour.
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

export { httpAdapter } from "./http.adapter"
export { localStorageAdapter, sessionStorageAdapter } from "./storage.adapter"
export { timerAdapter } from "./timer.adapter"
export { domAdapter } from "./dom.adapter"
export { notificationAdapter } from "./notification.adapter"
export { soundAdapter } from "./sound.adapter"
export { clipboardAdapter } from "./clipboard.adapter"
