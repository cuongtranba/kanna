import { useShallowStable } from "../hooks/useShallowStable"
import type { KannaState } from "./useKannaState"

export type SidebarActions = {
  onCreateChat: KannaState["handleCreateChat"]
  onForkChat: KannaState["handleForkChat"]
  onRenameChat: KannaState["handleRenameChat"]
  onArchiveChat: KannaState["handleArchiveChat"]
  onOpenArchivedChat: KannaState["handleOpenArchivedChat"]
  onDeleteChat: KannaState["handleDeleteChat"]
  onArchiveBulkChats: KannaState["handleArchiveBulkChats"]
  onDeleteBulkChats: KannaState["handleDeleteBulkChats"]
  onOpenAddProjectModal: KannaState["openAddProjectModal"]
  onCopyPath: KannaState["handleCopyPath"]
  onOpenExternalPath: KannaState["handleOpenExternalPath"]
  onHideProject: KannaState["handleHideProject"]
  onDeleteProject: KannaState["handleDeleteProject"]
  onToggleStar: KannaState["handleToggleProjectStar"]
  onTogglePinChat: KannaState["handleToggleChatPin"]
  onSetProjectInstructions: KannaState["handleSetProjectInstructions"]
  onReorderProjectGroups: KannaState["handleReorderProjectGroups"]
  onCreateStack: KannaState["handleCreateStack"]
  onRenameStack: KannaState["handleRenameStack"]
  onSetStackInstructions: KannaState["handleSetStackInstructions"]
  onRemoveStack: KannaState["handleRemoveStack"]
  onCreateStackChat: KannaState["handleCreateStackChat"]
  onListStackWorktrees: KannaState["handleListStackWorktrees"]
}

export function useSidebarActions(state: KannaState): SidebarActions {
  return useShallowStable<SidebarActions>({
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
  })
}
