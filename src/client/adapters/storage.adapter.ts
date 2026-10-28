import type { StoragePort } from "../ports/storagePort"

function storageAdapter(resolve: () => Storage | null): StoragePort {
  return {
    getItem(key: string): string | null {
      return resolve()?.getItem(key) ?? null
    },
    setItem(key: string, value: string): void {
      resolve()?.setItem(key, value)
    },
    removeItem(key: string): void {
      resolve()?.removeItem(key)
    },
    clear(): void {
      resolve()?.clear()
    },
  }
}

export const localStorageAdapter: StoragePort = storageAdapter(() => (typeof localStorage === "undefined" ? null : localStorage))

export const sessionStorageAdapter: StoragePort = storageAdapter(() => (typeof sessionStorage === "undefined" ? null : sessionStorage))
