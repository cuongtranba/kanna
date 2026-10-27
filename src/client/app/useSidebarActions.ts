import { useShallow } from "zustand/react/shallow"
import type { KannaState } from "./useKannaState"

function pickSidebarActions(state: KannaState) {
  return {
    onCreateChat: state.handleCreateChat,
    onForkChat: state.handleForkChat,
    onRenameChat: state.handleRenameChat,
    onArchiveChat: state.handleArchiveChat,
    onOpenArchivedChat: state.handleOpenArchivedChat,
    onDeleteChat: state.handleDeleteChat,
    onArchiveBulkChats: state.handleArchiveBulkChats,
    onDeleteBulkChats: state.handleDeleteBulkChats,
    onOpenAddProjectModal: state.openAddProjectModal,
    onCopyPath: state.handleCopyPath,
    onOpenExternalPath: state.handleOpenExternalPath,
    onHideProject: state.handleHideProject,
    onDeleteProject: state.handleDeleteProject,
    onToggleStar: state.handleToggleProjectStar,
    onTogglePinChat: state.handleToggleChatPin,
    onSetProjectInstructions: state.handleSetProjectInstructions,
    onReorderProjectGroups: state.handleReorderProjectGroups,
    onCreateStack: state.handleCreateStack,
    onRenameStack: state.handleRenameStack,
    onSetStackInstructions: state.handleSetStackInstructions,
    onRemoveStack: state.handleRemoveStack,
    onCreateStackChat: state.handleCreateStackChat,
    onListStackWorktrees: state.handleListStackWorktrees,
  }
}

export type SidebarActions = ReturnType<typeof pickSidebarActions>

function keepActions(actions: SidebarActions): SidebarActions {
  return actions
}

export function useSidebarActions(state: KannaState): SidebarActions {
  return useShallow(keepActions)(pickSidebarActions(state))
}
