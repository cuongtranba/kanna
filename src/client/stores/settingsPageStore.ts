import { create } from "zustand"
import { detectPushSupport, getStoredPushDeviceId, type PushPermissionState } from "../app/pushClient"
import type { LlmProviderDraft } from "../app/llmProviderDraft"
import type { GithubRelease, InstalledSkillSummary, SkillSearchResult } from "../../shared/types"
import type { PackageInventorySnapshot, PackageUpdateSnapshot } from "../../shared/packages/types"
import type { JsonValue } from "../../shared/json"

export type { GithubRelease }

export type ChangelogStatus = "idle" | "loading" | "success" | "error"

const EMPTY_SKILL_RESULTS: SkillSearchResult[] = []
const EMPTY_INSTALLED_SKILLS: InstalledSkillSummary[] = []
const EMPTY_RELEASES: GithubRelease[] = []
const EMPTY_KEYBINDING_DRAFTS: Record<string, string> = {}
const EMPTY_INSTALL_MESSAGES: Record<string, string> = {}

interface SettingsPageState {
  changelogPendingAction: string | null

  skillQuery: string
  skillResults: SkillSearchResult[]
  skillSearchLoading: boolean
  skillSearchError: string | null
  installedSkills: InstalledSkillSummary[]
  installedSkillIds: ReadonlySet<string>
  installedLoading: boolean
  installedError: string | null
  skillOperationError: string | null
  installingSkillId: string | null
  uninstallingSkillId: string | null
  installMessages: Record<string, string>
  packageUpdateSnapshot: PackageUpdateSnapshot | null

  pluginInventory: PackageInventorySnapshot | null
  pluginInventoryLoading: boolean
  pluginInventoryError: string | null

  globalInstructionsDraft: string
  globalInstructionsPersistedAtMount: string
  globalInstructionsSaving: boolean
  globalInstructionsError: string | null

  changelogStatus: ChangelogStatus
  signingOut: boolean
  authEnabled: boolean
  releases: GithubRelease[]
  changelogError: string | null
  pushPermissionState: PushPermissionState
  pushDeviceId: string | null
  scrollbackDraft: string
  minColumnWidthDraft: string
  tabMinWidthDraft: string
  uploadMaxFileSizeDraft: string
  claudeIdleMinutesDraft: string
  claudeMaxConcurrentDraft: string
  editorCommandDraft: string
  keybindingDrafts: Record<string, string>
  keybindingsError: string | null
  appSettingsError: string | null
  analyticsDialogOpen: boolean
  tunnelError: string | null
  cloudflaredPathDraft: string
  pushContactSubjectDraft: string
  shareDefaultTtlDraft: string
  llmProviderDraft: LlmProviderDraft
  llmProviderError: string | null
  llmValidationStatus: "idle" | "valid" | "invalid"
  llmValidationError: JsonValue | null
  llmValidationDialogOpen: boolean

  setChangelogPendingAction: (action: string | null) => void

  setSkillQuery: (query: string) => void
  setSkillResults: (results: SkillSearchResult[]) => void
  setSkillSearchLoading: (loading: boolean) => void
  setSkillSearchError: (error: string | null) => void
  setInstalledSkills: (skills: InstalledSkillSummary[]) => void
  setInstalledSkillIds: (ids: ReadonlySet<string>) => void
  addInstalledSkillId: (id: string) => void
  removeInstalledSkillId: (id: string) => void
  setInstalledLoading: (loading: boolean) => void
  setInstalledError: (error: string | null) => void
  setSkillOperationError: (error: string | null) => void
  setInstallingSkillId: (id: string | null) => void
  setUninstallingSkillId: (id: string | null) => void
  setInstallMessages: (messages: Record<string, string>) => void
  setInstallMessage: (skillId: string, message: string) => void
  clearInstallMessage: (skillId: string) => void
  clearInstallMessagesForSkill: (skillName: string) => void
  setPackageUpdateSnapshot: (snapshot: PackageUpdateSnapshot | null) => void

  setPluginInventory: (inventory: PackageInventorySnapshot | null) => void
  setPluginInventoryLoading: (loading: boolean) => void
  setPluginInventoryError: (error: string | null) => void

  setGlobalInstructionsDraft: (draft: string) => void
  setGlobalInstructionsPersistedAtMount: (value: string) => void
  setGlobalInstructionsSaving: (saving: boolean) => void
  setGlobalInstructionsError: (error: string | null) => void

  setChangelogStatus: (status: ChangelogStatus) => void
  setSigningOut: (signingOut: boolean) => void
  setAuthEnabled: (enabled: boolean) => void
  setReleases: (releases: GithubRelease[]) => void
  setChangelogError: (error: string | null) => void
  setPushPermissionState: (state: PushPermissionState) => void
  setPushDeviceId: (deviceId: string | null) => void
  setScrollbackDraft: (draft: string) => void
  setMinColumnWidthDraft: (draft: string) => void
  setTabMinWidthDraft: (draft: string) => void
  setUploadMaxFileSizeDraft: (draft: string) => void
  setClaudeIdleMinutesDraft: (draft: string) => void
  setClaudeMaxConcurrentDraft: (draft: string) => void
  setEditorCommandDraft: (draft: string) => void
  setKeybindingDrafts: (drafts: Record<string, string>) => void
  setKeybindingDraft: (action: string, value: string) => void
  setKeybindingsError: (error: string | null) => void
  setAppSettingsError: (error: string | null) => void
  setAnalyticsDialogOpen: (open: boolean) => void
  setTunnelError: (error: string | null) => void
  setCloudflaredPathDraft: (draft: string) => void
  setPushContactSubjectDraft: (draft: string) => void
  setShareDefaultTtlDraft: (draft: string) => void
  setLlmProviderDraft: (draft: LlmProviderDraft) => void
  setLlmProviderError: (error: string | null) => void
  setLlmValidationStatus: (status: "idle" | "valid" | "invalid") => void
  setLlmValidationError: (error: JsonValue | null) => void
  setLlmValidationDialogOpen: (open: boolean) => void
}

export const useSettingsPageStore = create<SettingsPageState>()((set, get) => ({
  changelogPendingAction: null,

  skillQuery: "",
  skillResults: EMPTY_SKILL_RESULTS,
  skillSearchLoading: false,
  skillSearchError: null,
  installedSkills: EMPTY_INSTALLED_SKILLS,
  installedSkillIds: new Set<string>(),
  installedLoading: false,
  installedError: null,
  skillOperationError: null,
  installingSkillId: null,
  uninstallingSkillId: null,
  installMessages: EMPTY_INSTALL_MESSAGES,
  packageUpdateSnapshot: null,

  pluginInventory: null,
  pluginInventoryLoading: false,
  pluginInventoryError: null,

  globalInstructionsDraft: "",
  globalInstructionsPersistedAtMount: "",
  globalInstructionsSaving: false,
  globalInstructionsError: null,

  changelogStatus: "idle",
  signingOut: false,
  authEnabled: false,
  releases: EMPTY_RELEASES,
  changelogError: null,
  pushPermissionState: detectPushSupport().state,
  pushDeviceId: getStoredPushDeviceId(),
  scrollbackDraft: "",
  minColumnWidthDraft: "",
  tabMinWidthDraft: "",
  uploadMaxFileSizeDraft: "",
  claudeIdleMinutesDraft: "",
  claudeMaxConcurrentDraft: "",
  editorCommandDraft: "",
  keybindingDrafts: EMPTY_KEYBINDING_DRAFTS,
  keybindingsError: null,
  appSettingsError: null,
  analyticsDialogOpen: false,
  tunnelError: null,
  cloudflaredPathDraft: "",
  pushContactSubjectDraft: "",
  shareDefaultTtlDraft: "",
  llmProviderDraft: {
    provider: "openai",
    apiKey: "",
    model: "",
    baseUrl: "",
  },
  llmProviderError: null,
  llmValidationStatus: "idle",
  llmValidationError: null,
  llmValidationDialogOpen: false,

  setChangelogPendingAction: (action) => set({ changelogPendingAction: action }),

  setSkillQuery: (query) => set({ skillQuery: query }),
  setSkillResults: (results) => set({ skillResults: results }),
  setSkillSearchLoading: (loading) => set({ skillSearchLoading: loading }),
  setSkillSearchError: (error) => set({ skillSearchError: error }),
  setInstalledSkills: (skills) => set({ installedSkills: skills }),
  setInstalledSkillIds: (ids) => set({ installedSkillIds: ids }),
  addInstalledSkillId: (id) => {
    const current = get().installedSkillIds
    const next = new Set(current)
    next.add(id)
    set({ installedSkillIds: next })
  },
  removeInstalledSkillId: (id) => {
    const current = get().installedSkillIds
    const next = new Set(current)
    next.delete(id)
    set({ installedSkillIds: next })
  },
  setInstalledLoading: (loading) => set({ installedLoading: loading }),
  setInstalledError: (error) => set({ installedError: error }),
  setSkillOperationError: (error) => set({ skillOperationError: error }),
  setInstallingSkillId: (id) => set({ installingSkillId: id }),
  setUninstallingSkillId: (id) => set({ uninstallingSkillId: id }),
  setInstallMessages: (messages) => set({ installMessages: messages }),
  setInstallMessage: (skillId, message) => {
    const current = get().installMessages
    set({ installMessages: { ...current, [skillId]: message } })
  },
  clearInstallMessage: (skillId) => {
    const current = get().installMessages
    const next = { ...current }
    delete next[skillId]
    set({ installMessages: next })
  },
  clearInstallMessagesForSkill: (skillName) => {
    const current = get().installMessages
    const next = { ...current }
    for (const key of Object.keys(next)) {
      if (key.endsWith(`/${skillName}`) || key === skillName) {
        delete next[key]
      }
    }
    set({ installMessages: next })
  },
  setPackageUpdateSnapshot: (snapshot) => set({ packageUpdateSnapshot: snapshot }),

  setPluginInventory: (inventory) => set({ pluginInventory: inventory }),
  setPluginInventoryLoading: (loading) => set({ pluginInventoryLoading: loading }),
  setPluginInventoryError: (error) => set({ pluginInventoryError: error }),

  setGlobalInstructionsDraft: (draft) => set({ globalInstructionsDraft: draft }),
  setGlobalInstructionsPersistedAtMount: (value) => set({ globalInstructionsPersistedAtMount: value }),
  setGlobalInstructionsSaving: (saving) => set({ globalInstructionsSaving: saving }),
  setGlobalInstructionsError: (error) => set({ globalInstructionsError: error }),

  setChangelogStatus: (status) => set({ changelogStatus: status }),
  setSigningOut: (signingOut) => set({ signingOut }),
  setAuthEnabled: (enabled) => set({ authEnabled: enabled }),
  setReleases: (releases) => set({ releases }),
  setChangelogError: (error) => set({ changelogError: error }),
  setPushPermissionState: (state) => set({ pushPermissionState: state }),
  setPushDeviceId: (deviceId) => set({ pushDeviceId: deviceId }),
  setScrollbackDraft: (draft) => set({ scrollbackDraft: draft }),
  setMinColumnWidthDraft: (draft) => set({ minColumnWidthDraft: draft }),
  setTabMinWidthDraft: (draft) => set({ tabMinWidthDraft: draft }),
  setUploadMaxFileSizeDraft: (draft) => set({ uploadMaxFileSizeDraft: draft }),
  setClaudeIdleMinutesDraft: (draft) => set({ claudeIdleMinutesDraft: draft }),
  setClaudeMaxConcurrentDraft: (draft) => set({ claudeMaxConcurrentDraft: draft }),
  setEditorCommandDraft: (draft) => set({ editorCommandDraft: draft }),
  setKeybindingDrafts: (drafts) => set({ keybindingDrafts: drafts }),
  setKeybindingDraft: (action, value) =>
    set((state) =>
      state.keybindingDrafts[action] === value
        ? state
        : { keybindingDrafts: { ...state.keybindingDrafts, [action]: value } },
    ),
  setKeybindingsError: (error) => set({ keybindingsError: error }),
  setAppSettingsError: (error) => set({ appSettingsError: error }),
  setAnalyticsDialogOpen: (open) => set({ analyticsDialogOpen: open }),
  setTunnelError: (error) => set({ tunnelError: error }),
  setCloudflaredPathDraft: (draft) => set({ cloudflaredPathDraft: draft }),
  setPushContactSubjectDraft: (draft) => set({ pushContactSubjectDraft: draft }),
  setShareDefaultTtlDraft: (draft) => set({ shareDefaultTtlDraft: draft }),
  setLlmProviderDraft: (draft) => set({ llmProviderDraft: draft }),
  setLlmProviderError: (error) => set({ llmProviderError: error }),
  setLlmValidationStatus: (status) => set({ llmValidationStatus: status }),
  setLlmValidationError: (error) => set({ llmValidationError: error }),
  setLlmValidationDialogOpen: (open) => set({ llmValidationDialogOpen: open }),
}))
