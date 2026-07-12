import { create } from "zustand"
import type {
  DiffCommitMode,
  ChatBranchListResult,
  ChatMergePreviewResult,
  GitHubPublishInfo,
  GitHubRepoAvailabilityResult,
} from "../../shared/types"

/**
 * Non-persisted transient UI state for RightSidebar and its sub-components
 * (BranchSwitcher, MergeBranchModal, GitHubPublishModal).
 *
 * Mirrors chatPageStore.ts in intent: ephemeral UI state that resets on reload,
 * kept out of the persisted rightSidebarStore.
 */

// ─── RightSidebarImpl slice ───────────────────────────────────────────────────

interface RightSidebarImplSlice {
  isGenerating: boolean
  commitModeInFlight: DiffCommitMode | null
  isSyncing: boolean
  isGitHubPublishModalOpen: boolean
  patchesByPath: Record<string, string>
  patchErrorsByPath: Record<string, string>
  loadingPatchPaths: Record<string, boolean>
  setIsGenerating: (v: boolean) => void
  setCommitModeInFlight: (v: DiffCommitMode | null) => void
  setIsSyncing: (v: boolean) => void
  setIsGitHubPublishModalOpen: (v: boolean) => void
  /** Remove stale patches when the diff file list changes. */
  reconcilePatches: (filePaths: string[], isCurrentDigest: (path: string) => boolean) => void
  setPatchLoading: (path: string) => void
  clearPatchLoading: (path: string) => void
  clearPatchError: (path: string) => void
  setPatchResult: (path: string, patch: string) => void
  setPatchError: (path: string, message: string) => void
}

// ─── BranchSwitcher slice ─────────────────────────────────────────────────────

interface BranchSwitcherSlice {
  branchSwitcherOpen: boolean
  mergeModalOpen: boolean
  branchSwitcherIsLoading: boolean
  branchSwitcherIsMutating: boolean
  branchSwitcherQuery: string
  branchSwitcherEntryView: "branches" | "pull_requests"
  branchList: ChatBranchListResult | null
  branchSwitcherError: string | null
  setBranchSwitcherOpen: (v: boolean) => void
  setMergeModalOpen: (v: boolean) => void
  setBranchSwitcherIsLoading: (v: boolean) => void
  setBranchSwitcherIsMutating: (v: boolean) => void
  setBranchSwitcherQuery: (v: string) => void
  setBranchSwitcherEntryView: (v: "branches" | "pull_requests") => void
  setBranchList: (v: ChatBranchListResult | null) => void
  setBranchSwitcherError: (v: string | null) => void
}

// ─── MergeBranchModal slice ───────────────────────────────────────────────────

interface MergeBranchModalSlice {
  mergeBranchQuery: string
  mergeBranchSelectedName: string | null
  mergePreview: ChatMergePreviewResult | null
  mergePreviewError: string | null
  isMergePreviewLoading: boolean
  isMergeBranching: boolean
  setMergeBranchQuery: (v: string) => void
  setMergeBranchSelectedName: (v: string | null) => void
  setMergePreview: (v: ChatMergePreviewResult | null) => void
  setMergePreviewError: (v: string | null) => void
  setIsMergePreviewLoading: (v: boolean) => void
  setIsMergeBranching: (v: boolean) => void
  /** Reset all state when the modal closes. */
  resetMergeBranchModal: () => void
  /** Reset only the preview (when selected branch changes or modal re-opens). */
  resetMergePreview: () => void
}

// ─── GitHubPublishModal slice ─────────────────────────────────────────────────

interface GitHubPublishModalSlice {
  publishInfo: GitHubPublishInfo | null
  isLoadingPublishInfo: boolean
  publishOwner: string
  publishName: string
  publishVisibility: "public" | "private"
  publishDescription: string
  publishAvailability: GitHubRepoAvailabilityResult | null
  isCheckingPublishAvailability: boolean
  isPublishing: boolean
  setPublishInfo: (v: GitHubPublishInfo | null) => void
  setIsLoadingPublishInfo: (v: boolean) => void
  setPublishOwner: (v: string) => void
  setPublishName: (v: string) => void
  setPublishVisibility: (v: "public" | "private") => void
  setPublishDescription: (v: string) => void
  setPublishAvailability: (v: GitHubRepoAvailabilityResult | null) => void
  setIsCheckingPublishAvailability: (v: boolean) => void
  setIsPublishing: (v: boolean) => void
}

// ─── Combined store ───────────────────────────────────────────────────────────

type RightSidebarUiState = RightSidebarImplSlice
  & BranchSwitcherSlice
  & MergeBranchModalSlice
  & GitHubPublishModalSlice

export const useRightSidebarUiStore = create<RightSidebarUiState>()((set) => ({
  // ── RightSidebarImpl ──────────────────────────────────────────────────────
  isGenerating: false,
  commitModeInFlight: null,
  isSyncing: false,
  isGitHubPublishModalOpen: false,
  patchesByPath: {},
  patchErrorsByPath: {},
  loadingPatchPaths: {},

  setIsGenerating: (v) => set({ isGenerating: v }),
  setCommitModeInFlight: (v) => set({ commitModeInFlight: v }),
  setIsSyncing: (v) => set({ isSyncing: v }),
  setIsGitHubPublishModalOpen: (v) => set({ isGitHubPublishModalOpen: v }),

  reconcilePatches: (filePaths, isCurrentDigest) => set((state) => ({
    patchesByPath: Object.fromEntries(
      Object.entries(state.patchesByPath).filter(([path]) => filePaths.includes(path) && isCurrentDigest(path))
    ),
    patchErrorsByPath: Object.fromEntries(
      Object.entries(state.patchErrorsByPath).filter(([path]) => filePaths.includes(path) && isCurrentDigest(path))
    ),
    loadingPatchPaths: Object.fromEntries(
      Object.entries(state.loadingPatchPaths).filter(([path]) => filePaths.includes(path) && isCurrentDigest(path))
    ),
  })),
  setPatchLoading: (path) => set((state) => ({
    loadingPatchPaths: { ...state.loadingPatchPaths, [path]: true },
  })),
  clearPatchLoading: (path) => set((state) => {
    const { [path]: _removed, ...rest } = state.loadingPatchPaths
    return { loadingPatchPaths: rest }
  }),
  clearPatchError: (path) => set((state) => {
    if (!(path in state.patchErrorsByPath)) return state
    const { [path]: _removed, ...rest } = state.patchErrorsByPath
    return { patchErrorsByPath: rest }
  }),
  setPatchResult: (path, patch) => set((state) => ({
    patchesByPath: { ...state.patchesByPath, [path]: patch },
  })),
  setPatchError: (path, message) => set((state) => ({
    patchErrorsByPath: { ...state.patchErrorsByPath, [path]: message },
  })),

  // ── BranchSwitcher ────────────────────────────────────────────────────────
  branchSwitcherOpen: false,
  mergeModalOpen: false,
  branchSwitcherIsLoading: false,
  branchSwitcherIsMutating: false,
  branchSwitcherQuery: "",
  branchSwitcherEntryView: "branches",
  branchList: null,
  branchSwitcherError: null,

  setBranchSwitcherOpen: (v) => set({ branchSwitcherOpen: v }),
  setMergeModalOpen: (v) => set({ mergeModalOpen: v }),
  setBranchSwitcherIsLoading: (v) => set({ branchSwitcherIsLoading: v }),
  setBranchSwitcherIsMutating: (v) => set({ branchSwitcherIsMutating: v }),
  setBranchSwitcherQuery: (v) => set({ branchSwitcherQuery: v }),
  setBranchSwitcherEntryView: (v) => set({ branchSwitcherEntryView: v }),
  setBranchList: (v) => set({ branchList: v }),
  setBranchSwitcherError: (v) => set({ branchSwitcherError: v }),

  // ── MergeBranchModal ──────────────────────────────────────────────────────
  mergeBranchQuery: "",
  mergeBranchSelectedName: null,
  mergePreview: null,
  mergePreviewError: null,
  isMergePreviewLoading: false,
  isMergeBranching: false,

  setMergeBranchQuery: (v) => set({ mergeBranchQuery: v }),
  setMergeBranchSelectedName: (v) => set({ mergeBranchSelectedName: v }),
  setMergePreview: (v) => set({ mergePreview: v }),
  setMergePreviewError: (v) => set({ mergePreviewError: v }),
  setIsMergePreviewLoading: (v) => set({ isMergePreviewLoading: v }),
  setIsMergeBranching: (v) => set({ isMergeBranching: v }),
  resetMergeBranchModal: () => set({
    mergeBranchQuery: "",
    mergeBranchSelectedName: null,
    mergePreview: null,
    mergePreviewError: null,
    isMergePreviewLoading: false,
    isMergeBranching: false,
  }),
  resetMergePreview: () => set({
    mergePreview: null,
    mergePreviewError: null,
    isMergePreviewLoading: false,
  }),

  // ── GitHubPublishModal ────────────────────────────────────────────────────
  publishInfo: null,
  isLoadingPublishInfo: false,
  publishOwner: "",
  publishName: "",
  publishVisibility: "private",
  publishDescription: "",
  publishAvailability: null,
  isCheckingPublishAvailability: false,
  isPublishing: false,

  setPublishInfo: (v) => set({ publishInfo: v }),
  setIsLoadingPublishInfo: (v) => set({ isLoadingPublishInfo: v }),
  setPublishOwner: (v) => set({ publishOwner: v }),
  setPublishName: (v) => set({ publishName: v }),
  setPublishVisibility: (v) => set({ publishVisibility: v }),
  setPublishDescription: (v) => set({ publishDescription: v }),
  setPublishAvailability: (v) => set({ publishAvailability: v }),
  setIsCheckingPublishAvailability: (v) => set({ isCheckingPublishAvailability: v }),
  setIsPublishing: (v) => set({ isPublishing: v }),
}))
