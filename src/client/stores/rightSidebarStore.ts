import { create } from "zustand"
import { persist } from "zustand/middleware"
import { isJsonObject, type JsonObject, type JsonValue } from "../../shared/json"
import { asJsonValue } from "../lib/asJsonValue"

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
  /** Set one commit field without the caller re-passing its sibling. */
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

function createDefaultProjectVisibilityState(): ProjectRightSidebarVisibilityState {
  return {
    isVisible: false,
  }
}

function createDefaultProjectUiState(): ProjectRightSidebarUiState {
  return {
    viewMode: "history",
    collapsedPaths: {},
    summary: "",
    description: "",
  }
}

function getProjectVisibilityState(
  projects: Record<string, ProjectRightSidebarVisibilityState>,
  projectId: string
): ProjectRightSidebarVisibilityState {
  return projects[projectId] ?? createDefaultProjectVisibilityState()
}

/**
 * The persisted blob is a JSON boundary — written by an older build, possibly
 * hand-edited — so every field is read through a guard rather than asserted
 * into the current shape.
 */
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
      reconcileCollapsedPaths: (projectId, paths) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        const nextCollapsedPaths = Object.fromEntries(paths.map((path) => [path, current.collapsedPaths[path] ?? true]))
        if (
          Object.keys(current.collapsedPaths).length === Object.keys(nextCollapsedPaths).length
          && Object.entries(nextCollapsedPaths).every(([path, collapsed]) => current.collapsedPaths[path] === collapsed)
        ) {
          return state
        }
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              collapsedPaths: nextCollapsedPaths,
            },
          },
        }
      }),
      toggleCollapsedPath: (projectId, path) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              collapsedPaths: {
                ...current.collapsedPaths,
                [path]: !(current.collapsedPaths[path] ?? true),
              },
            },
          },
        }
      }),
      setViewMode: (projectId, viewMode) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        if (current.viewMode === viewMode) return state
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              viewMode,
            },
          },
        }
      }),
      setCommitDraft: (projectId, draft) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        if (current.summary === draft.summary && current.description === draft.description) return state
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              summary: draft.summary,
              description: draft.description,
            },
          },
        }
      }),
      setCommitSummary: (projectId, summary) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        if (current.summary === summary) return state
        return {
          projectUi: { ...state.projectUi, [projectId]: { ...current, summary } },
        }
      }),
      setCommitDescription: (projectId, description) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        if (current.description === description) return state
        return {
          projectUi: { ...state.projectUi, [projectId]: { ...current, description } },
        }
      }),
      clearCommitDraft: (projectId) => set((state) => {
        const current = state.projectUi[projectId] ?? createDefaultProjectUiState()
        if (!current.summary && !current.description) return state
        return {
          projectUi: {
            ...state.projectUi,
            [projectId]: {
              ...current,
              summary: "",
              description: "",
            },
          },
        }
      }),
      clearProject: (projectId) =>
        set((state) => {
          const { [projectId]: _removedLayout, ...restProjects } = state.projects
          const { [projectId]: _removedUi, ...restProjectUi } = state.projectUi
          return { projects: restProjects, projectUi: restProjectUi }
        }),
    }),
    {
      name: "right-sidebar-layouts",
      version: 4,
      migrate: (persistedState) => migrateRightSidebarStore(asJsonValue(persistedState)),
    }
  )
)

export const DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE: ProjectRightSidebarVisibilityState = {
  isVisible: false,
}

export function getDefaultRightSidebarVisibilityState() {
  return {
    ...DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE,
  }
}
