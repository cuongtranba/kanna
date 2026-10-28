import { create } from "zustand"
import { persist } from "zustand/middleware"
import { omitKey, reconcileFlags } from "../lib/recordOps"

interface DiffCommitState {
  checkedPathsByProjectId: Record<string, Record<string, boolean>>
  reconcileProject: (projectId: string, paths: string[]) => void
  toggleChecked: (projectId: string, path: string) => void
  toggleAllChecked: (projectId: string, paths: string[]) => void
  clearProject: (projectId: string) => void
}

export const useDiffCommitStore = create<DiffCommitState>()(
  persist(
    (set) => ({
      checkedPathsByProjectId: {},
      reconcileProject: (projectId, paths) => set((state) => {
        const current = state.checkedPathsByProjectId[projectId] ?? {}
        const next = reconcileFlags(current, paths, true)
        if (next === current) return state
        return {
          checkedPathsByProjectId: {
            ...state.checkedPathsByProjectId,
            [projectId]: next,
          },
        }
      }),
      toggleChecked: (projectId, path) => set((state) => {
        const current = state.checkedPathsByProjectId[projectId] ?? {}
        return {
          checkedPathsByProjectId: {
            ...state.checkedPathsByProjectId,
            [projectId]: { ...current, [path]: !(current[path] ?? true) },
          },
        }
      }),
      toggleAllChecked: (projectId, paths) => set((state) => {
        if (paths.length === 0) return state
        const current = state.checkedPathsByProjectId[projectId] ?? {}
        const allSelected = paths.every((path) => current[path] ?? true)
        const next = !allSelected
        return {
          checkedPathsByProjectId: {
            ...state.checkedPathsByProjectId,
            [projectId]: {
              ...current,
              ...Object.fromEntries(paths.map((path) => [path, next])),
            },
          },
        }
      }),
      clearProject: (projectId) => set((state) => {
        return { checkedPathsByProjectId: omitKey(state.checkedPathsByProjectId, projectId) }
      }),
    }),
    {
      name: "diff-commit-selections",
      version: 2,
    }
  )
)
