import { create } from "zustand"
import type { InstalledSkillSummary, SkillSearchResult } from "../../shared/types"

const EMPTY_RESULTS: SkillSearchResult[] = []
const EMPTY_INSTALLED: InstalledSkillSummary[] = []
const EMPTY_MESSAGES: Readonly<Record<string, string>> = {}
const INSTALLED_MESSAGE = "Installed globally"

interface SkillsSectionState {
  query: string
  results: SkillSearchResult[]
  searchLoading: boolean
  searchError: string | null
  installedSkills: InstalledSkillSummary[]
  installedSkillIds: ReadonlySet<string>
  installedLoading: boolean
  installedError: string | null
  operationError: string | null
  installMessages: Readonly<Record<string, string>>

  setQuery: (query: string) => void
  searchCleared: (error: string | null) => void
  searchStarted: () => void
  searchSucceeded: (results: SkillSearchResult[]) => void
  searchFailed: (message: string) => void
  installedCleared: () => void
  installedLoadStarted: () => void
  installedLoaded: (skills: InstalledSkillSummary[]) => void
  installedLoadFailed: (message: string) => void
  installedLoadFinished: () => void
  setOperationError: (message: string | null) => void
  installStarted: (skillId: string) => void
  installSucceeded: (skillId: string) => void
  uninstallSucceeded: (skillId: string) => void
}

function namesOf(skills: readonly InstalledSkillSummary[]): ReadonlySet<string> {
  return new Set(skills.map((skill) => skill.name))
}

function withoutKey(messages: Readonly<Record<string, string>>, key: string): Readonly<Record<string, string>> {
  const { [key]: _removed, ...rest } = messages
  return rest
}

export const useSkillsSectionStore = create<SkillsSectionState>()((set) => ({
  query: "",
  results: EMPTY_RESULTS,
  searchLoading: false,
  searchError: null,
  installedSkills: EMPTY_INSTALLED,
  installedSkillIds: new Set<string>(),
  installedLoading: false,
  installedError: null,
  operationError: null,
  installMessages: EMPTY_MESSAGES,

  setQuery: (query) => set({ query }),
  searchCleared: (searchError) => set({ results: EMPTY_RESULTS, searchError, searchLoading: false }),
  searchStarted: () => set({ searchLoading: true, searchError: null }),
  searchSucceeded: (results) => set({ results, searchLoading: false }),
  searchFailed: (searchError) => set({ results: EMPTY_RESULTS, searchError, searchLoading: false }),
  installedCleared: () =>
    set({ installedSkills: EMPTY_INSTALLED, installedSkillIds: new Set<string>(), installedError: null, installedLoading: false }),
  installedLoadStarted: () => set({ installedLoading: true, installedError: null }),
  installedLoaded: (skills) => set({ installedSkills: skills, installedSkillIds: namesOf(skills) }),
  installedLoadFailed: (installedError) =>
    set({ installedSkills: EMPTY_INSTALLED, installedSkillIds: new Set<string>(), installedError }),
  installedLoadFinished: () => set({ installedLoading: false }),
  setOperationError: (operationError) => set({ operationError }),
  installStarted: (skillId) =>
    set((state) => ({ operationError: null, installMessages: withoutKey(state.installMessages, skillId) })),
  installSucceeded: (skillId) =>
    set((state) => ({
      installedSkillIds: new Set([...state.installedSkillIds, skillId]),
      installMessages: { ...state.installMessages, [skillId]: INSTALLED_MESSAGE },
    })),
  uninstallSucceeded: (skillId) =>
    set((state) => ({
      installedSkills: state.installedSkills.filter((skill) => skill.name !== skillId),
      installedSkillIds: new Set([...state.installedSkillIds].filter((id) => id !== skillId)),
      installMessages: withoutKey(state.installMessages, skillId),
    })),
}))
