import { memo } from "react"
import { TerminalWorkspace } from "../../components/chat-ui/TerminalWorkspace"
import { useTerminalLayoutStore } from "../../stores/terminalLayoutStore"
import type { KannaState } from "../useKannaState"

/**
 * The terminal workspace as a pane's content.
 *
 * There is deliberately no height prop. Before the pane tree this was a
 * fixed-height strip pinned under the transcript, so ChatPage measured and
 * passed a pixel height; now the pane owns the box and the workspace simply
 * fills it. A fixed height here would fight the resize handles.
 */
interface TerminalWorkspaceShellProps {
  projectId: string
  terminalLayout: ReturnType<typeof useTerminalLayoutStore.getState>["projects"][string]
  addTerminal: ReturnType<typeof useTerminalLayoutStore.getState>["addTerminal"]
  socket: KannaState["socket"]
  connectionStatus: KannaState["connectionStatus"]
  scrollback: number
  minColumnWidth: number
  splitTerminalShortcut?: string[]
  focusRequestVersion: number
  onTerminalCommandSent?: () => void
  onRemoveTerminal: (projectId: string, terminalId: string) => void
  onTerminalLayout: ReturnType<typeof useTerminalLayoutStore.getState>["setTerminalSizes"]
}

export const TerminalWorkspaceShell = memo(({
  projectId,
  terminalLayout,
  addTerminal,
  socket,
  connectionStatus,
  scrollback,
  minColumnWidth,
  splitTerminalShortcut,
  focusRequestVersion,
  onTerminalCommandSent,
  onRemoveTerminal,
  onTerminalLayout,
}: TerminalWorkspaceShellProps) => {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <TerminalWorkspace
        projectId={projectId}
        layout={terminalLayout}
        onAddTerminal={addTerminal}
        socket={socket}
        connectionStatus={connectionStatus}
        scrollback={scrollback}
        minColumnWidth={minColumnWidth}
        splitTerminalShortcut={splitTerminalShortcut}
        focusRequestVersion={focusRequestVersion}
        onTerminalCommandSent={onTerminalCommandSent}
        onRemoveTerminal={onRemoveTerminal}
        onTerminalLayout={onTerminalLayout}
      />
    </div>
  )
})
