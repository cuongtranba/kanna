import { DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE, useRightSidebarStore } from "./rightSidebarStore"
import { DEFAULT_PROJECT_TERMINAL_LAYOUT, useTerminalLayoutStore } from "./terminalLayoutStore"

export function useProjectPanelVisibility(projectId: string | null) {
  const projectTerminalLayout = useTerminalLayoutStore((store) => (projectId ? store.projects[projectId] : undefined))
  const projectRightSidebarVisibility = useRightSidebarStore((store) => (projectId ? store.projects[projectId] : undefined))
  const terminalLayout = projectTerminalLayout ?? DEFAULT_PROJECT_TERMINAL_LAYOUT
  const rightSidebarVisibility = projectRightSidebarVisibility ?? DEFAULT_RIGHT_SIDEBAR_VISIBILITY_STATE
  return {
    terminalLayout,
    showTerminalPane: Boolean(projectId && terminalLayout.isVisible && terminalLayout.terminals.length > 0),
    showRightSidebar: Boolean(projectId && rightSidebarVisibility.isVisible),
  }
}
