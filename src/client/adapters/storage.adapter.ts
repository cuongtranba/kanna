/**
 * storage.adapter.ts — localStorage implementation of StoragePort.
 *
 * A thin wrapper over window.localStorage. Guards against environments
 * where localStorage is absent (SSR stubs, some private-browsing modes).
 *
 * Architecture: .c3/adr/adr-20260715-client-state-effect-architecture.md
 */

import type { StoragePort } from "../ports/storagePort"

function guardedStorage(): Storage | null {
  if (typeof localStorage === "undefined") return null
  return localStorage
}

export const localStorageAdapter: StoragePort = {
  getItem(key: string): string | null {
    return guardedStorage()?.getItem(key) ?? null
  },
  setItem(key: string, value: string): void {
    guardedStorage()?.setItem(key, value)
  },
  removeItem(key: string): void {
    guardedStorage()?.removeItem(key)
  },
  clear(): void {
    guardedStorage()?.clear()
  },
}

function guardedSessionStorage(): Storage | null {
  if (typeof sessionStorage === "undefined") return null
  return sessionStorage
}

export const sessionStorageAdapter: StoragePort = {
  getItem(key: string): string | null {
    return guardedSessionStorage()?.getItem(key) ?? null
  },
  setItem(key: string, value: string): void {
    guardedSessionStorage()?.setItem(key, value)
  },
  removeItem(key: string): void {
    guardedSessionStorage()?.removeItem(key)
  },
  clear(): void {
    guardedSessionStorage()?.clear()
  },
}
