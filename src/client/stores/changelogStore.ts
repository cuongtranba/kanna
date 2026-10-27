import { create } from "zustand"
import type { GithubRelease } from "../../shared/types"

export type ChangelogStatus = "idle" | "loading" | "success" | "error"

const EMPTY_RELEASES: GithubRelease[] = []

interface ChangelogState {
  status: ChangelogStatus
  releases: GithubRelease[]
  error: string | null

  loadStarted: () => void
  loaded: (releases: GithubRelease[]) => void
  loadFailed: (message: string) => void
}

export const useChangelogStore = create<ChangelogState>()((set) => ({
  status: "idle",
  releases: EMPTY_RELEASES,
  error: null,

  loadStarted: () => set({ status: "loading", error: null }),
  loaded: (releases) => set({ releases, status: "success" }),
  loadFailed: (error) => set({ error, status: "error" }),
}))
