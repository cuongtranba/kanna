import { create } from "zustand"
import type { PackageInventorySnapshot, PackageUpdateSnapshot } from "../../shared/packages/types"

interface PackageInventoryState {
  inventory: PackageInventorySnapshot | null
  loading: boolean
  error: string | null
  updateSnapshot: PackageUpdateSnapshot | null

  inventoryCleared: () => void
  inventoryLoadStarted: () => void
  inventoryLoaded: (inventory: PackageInventorySnapshot) => void
  inventoryLoadFailed: (message: string) => void
  inventoryLoadFinished: () => void
  setUpdateSnapshot: (snapshot: PackageUpdateSnapshot | null) => void
}

export const usePackageInventoryStore = create<PackageInventoryState>()((set) => ({
  inventory: null,
  loading: false,
  error: null,
  updateSnapshot: null,

  inventoryCleared: () => set({ inventory: null, error: null, loading: false }),
  inventoryLoadStarted: () => set({ loading: true, error: null }),
  inventoryLoaded: (inventory) => set({ inventory }),
  inventoryLoadFailed: (error) => set({ error }),
  inventoryLoadFinished: () => set({ loading: false }),
  setUpdateSnapshot: (updateSnapshot) => set({ updateSnapshot }),
}))
