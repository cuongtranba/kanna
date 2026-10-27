import { create } from "zustand"
import type {
  DiffCommitMode,
  ChatBranchListResult,
  ChatMergePreviewResult,
  GitHubPublishInfo,
  GitHubRepoAvailabilityResult,
  GitRepoVisibility,
} from "../../shared/types"
import { omitKey } from "../lib/recordOps"



interface RightSidebarImplSlice {
  commitModeInFlight: DiffCommitMode | null
  isGitHubPublishModalOpen: boolean
  patchesByPath: Record<string, string>
  patchErrorsByPath: Record<string, string>
  loadingPatchPaths: Record<string, boolean>
  setCommitModeInFlight: (v: DiffCommitMode | null) => void
  setIsGitHubPublishModalOpen: (v: boolean) => void
  reconcilePatches: (filePaths: string[], isCurrentDigest: (path: string) => boolean) => void
  setPatchLoading: (path: string) => void
  clearPatchLoading: (path: string) => void
  clearPatchError: (path: string) => void
  setPatchResult: (path: string, patch: string) => void
  setPatchError: (path: string, message: string) => void
}


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
  resetMergeBranchModal: () => void
  resetMergePreview: () => void
}


interface GitHubPublishModalSlice {
  publishInfo: GitHubPublishInfo | null
  isLoadingPublishInfo: boolean
  publishOwner: string
  publishName: string
  publishVisibility: GitRepoVisibility
  publishDescription: string
  publishAvailability: GitHubRepoAvailabilityResult | null
  isCheckingPublishAvailability: boolean
  isPublishing: boolean
  setPublishInfo: (v: GitHubPublishInfo | null) => void
  setIsLoadingPublishInfo: (v: boolean) => void
  setPublishOwner: (v: string) => void
  setPublishName: (v: string) => void
  setPublishVisibility: (v: GitRepoVisibility) => void
  setPublishDescription: (v: string) => void
  setPublishAvailability: (v: GitHubRepoAvailabilityResult | null) => void
  setIsCheckingPublishAvailability: (v: boolean) => void
  setIsPublishing: (v: boolean) => void
}


type RightSidebarUiState = RightSidebarImplSlice
  & BranchSwitcherSlice
  & MergeBranchModalSlice
  & GitHubPublishModalSlice

export const useRightSidebarUiStore = create<RightSidebarUiState>()((set) => ({
  commitModeInFlight: null,
  isGitHubPublishModalOpen: false,
  patchesByPath: {},
  patchErrorsByPath: {},
  loadingPatchPaths: {},

  setCommitModeInFlight: (v) => set({ commitModeInFlight: v }),
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
    return { loadingPatchPaths: omitKey(state.loadingPatchPaths, path) }
  }),
  clearPatchError: (path) => set((state) => {
    if (!(path in state.patchErrorsByPath)) return state
    return { patchErrorsByPath: omitKey(state.patchErrorsByPath, path) }
  }),
  setPatchResult: (path, patch) => set((state) => ({
    patchesByPath: { ...state.patchesByPath, [path]: patch },
  })),
  setPatchError: (path, message) => set((state) => ({
    patchErrorsByPath: { ...state.patchErrorsByPath, [path]: message },
  })),

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
