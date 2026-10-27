import { create } from "zustand"
import { persist } from "zustand/middleware"
import { isJsonObject, type JsonObject, type JsonValue } from "../../shared/json"
import { asJsonValue } from "../lib/asJsonValue"
import { omitKey, reconcileFlags } from "../lib/recordOps"

export interface ProjectRightSidebarVisibilityState {
  isVisible: boolean
}

export interface ProjectRightSidebarUiState {
  viewMode: "changes" | "history"
  collapsedPaths: Record<string, boolean>
  summary: string
  description: string
}

interface RightSidebarState {
  size: number
  projects: Record<string, ProjectRightSidebarVisibilityState>
  projectUi: Record<string, ProjectRightSidebarUiState>
  toggleVisibility: (projectId: string) => void
  setSize: (size: number) => void
  reconcileCollapsedPaths: (projectId: string, paths: string[]) => void
  toggleCollapsedPath: (projectId: string, path: string) => void
  setViewMode: (projectId: string, viewMode: ProjectRightSidebarUiState["viewMode"]) => void
  setCommitDraft: (projectId: string, draft: Pick<ProjectRightSidebarUiState, "summary" | "description">) => void
  clearCommitDraft: (projectId: string) => void
  setCommitSummary: (projectId: string, summary: string) => void
  setCommitDescription: (projectId: string, description: string) => void
  clearProject: (projectId: string) => void
}

export const RIGHT_SIDEBAR_MIN_SIZE_PERCENT = 20
export const DEFAULT_RIGHT_SIDEBAR_SIZE = 33
export const RIGHT_SIDEBAR_MIN_WIDTH_PX = 370

function clampSize(size: number) {
  if (!Number.isFinite(size)) return DEFAULT_RIGHT_SIDEBAR_SIZE
  return Math.max(RIGHT_SIDEBAR_MIN_SIZE_PERCENT, size)
}

export const DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE: ProjectRightSidebarVisibilityState = {
  isVisible: false,
}

function createDefaultProjectVisibilityState(): ProjectRightSidebarVisibilityState {
  return { ...DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE }
}

function createDefaultProjectUiState(): ProjectRightSidebarUiState {
  return {
    viewMode: "history",
    collapsedPaths: {},
    summary: "",
    description: "",
  }
}

function updateProjectUi(
  state: RightSidebarState,
  projectId: string,
  update: (current: ProjectRightSidebarUiState) => ProjectRightSidebarUiState,
): RightSidebarState | Pick<RightSidebarState, "projectUi"> {
  const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
  const next = update(current)
  if (next === current) return state
  return { projectUi: { ...state.projectUi, [projectId]: next } }
}

function getProjectVisibilityState(
  projects: Record<string, ProjectRightSidebarVisibilityState>,
  projectId: string
): ProjectRightSidebarVisibilityState {
  return projects[projectId] ?? createDefaultProjectVisibilityState()
}

function firstFiniteProjectSize(projects: JsonObject): number | null {
  for (const layout of Object.values(projects)) {
    if (isJsonObject(layout) && typeof layout.size === "number" && Number.isFinite(layout.size)) {
      return layout.size
    }
  }
  return null
}

function readProjectUiState(value: JsonValue): ProjectRightSidebarUiState | null {
  if (!isJsonObject(value)) return null
  const collapsedPaths: Record<string, boolean> = {}
  if (isJsonObject(value.collapsedPaths)) {
    for (const [path, collapsed] of Object.entries(value.collapsedPaths)) {
      if (typeof collapsed === "boolean") collapsedPaths[path] = collapsed
    }
  }
  return {
    viewMode: value.viewMode === "changes" ? "changes" : "history",
    collapsedPaths,
    summary: typeof value.summary === "string" ? value.summary : "",
    description: typeof value.description === "string" ? value.description : "",
  }
}

export function migrateRightSidebarStore(persistedState: JsonValue) {
  if (!isJsonObject(persistedState)) {
    return { size: DEFAULT_RIGHT_SIDEBAR_SIZE, projects: {}, projectUi: {} }
  }

  const persistedProjects = isJsonObject(persistedState.projects) ? persistedState.projects : {}
  const rootSize = persistedState.size
  const globalSize = typeof rootSize === "number" && Number.isFinite(rootSize)
    ? clampSize(rootSize)
    : clampSize(firstFiniteProjectSize(persistedProjects) ?? DEFAULT_RIGHT_SIDEBAR_SIZE)

  const projects: Record<string, ProjectRightSidebarVisibilityState> = {}
  for (const [projectId, layout] of Object.entries(persistedProjects)) {
    projects[projectId] = { isVisible: isJsonObject(layout) && layout.isVisible === true }
  }

  const projectUi: Record<string, ProjectRightSidebarUiState> = {}
  if (isJsonObject(persistedState.projectUi)) {
    for (const [projectId, ui] of Object.entries(persistedState.projectUi)) {
      const parsed = readProjectUiState(ui)
      if (parsed) projectUi[projectId] = parsed
    }
  }

  return { size: globalSize, projects, projectUi }
}

export const useRightSidebarStore = create<RightSidebarState>()(
  persist(
    (set) => ({
      size: DEFAULT_RIGHT_SIDEBAR_SIZE,
      projects: {},
      projectUi: {},
      toggleVisibility: (projectId) =>
        set((state) => ({
          projects: {
            ...state.projects,
            [projectId]: {
              ...getProjectVisibilityState(state.projects, projectId),
              isVisible: !getProjectVisibilityState(state.projects, projectId).isVisible,
            },
          },
        })),
      setSize: (size) => set({ size: clampSize(size) }),
      reconcileCollapsedPaths: (projectId, paths) => set((state) => updateProjectUi(state, projectId, (current) => {
        const collapsedPaths = reconcileFlags(current.collapsedPaths, paths, true)
        return collapsedPaths === current.collapsedPaths ? current : { ...current, collapsedPaths }
      })),
      toggleCollapsedPath: (projectId, path) => set((state) => updateProjectUi(state, projectId, (current) => ({
        ...current,
        collapsedPaths: { ...current.collapsedPaths, [path]: !(current.collapsedPaths[path] ?? true) },
      }))),
      setViewMode: (projectId, viewMode) => set((state) => updateProjectUi(state, projectId, (current) => (
        current.viewMode === viewMode ? current : { ...current, viewMode }
      ))),
      setCommitDraft: (projectId, draft) => set((state) => updateProjectUi(state, projectId, (current) => (
        current.summary === draft.summary && current.description === draft.description
          ? current
          : { ...current, summary: draft.summary, description: draft.description }
      ))),
      setCommitSummary: (projectId, summary) => set((state) => updateProjectUi(state, projectId, (current) => (
        current.summary === summary ? current : { ...current, summary }
      ))),
      setCommitDescription: (projectId, description) => set((state) => updateProjectUi(state, projectId, (current) => (
        current.description === description ? current : { ...current, description }
      ))),
      clearCommitDraft: (projectId) => set((state) => updateProjectUi(state, projectId, (current) => (
        !current.summary && !current.description ? current : { ...current, summary: "", description: "" }
      ))),
      clearProject: (projectId) =>
        set((state) => ({ projects: omitKey(state.projects, projectId), projectUi: omitKey(state.projectUi, projectId) })),
    }),
    {
      name: "right-sidebar-layouts",
      version: 4,
      migrate: (persistedState) => migrateRightSidebarStore(asJsonValue(persistedState)),
    }
  )
)
