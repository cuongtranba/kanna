import { memo, type RefObject } from "react"
import { ChatInput, type ChatInputHandle } from "../../components/chat-ui/ChatInput"
import { type ContextWindowSnapshot, type SessionTotals } from "../../lib/contextWindow"
import type { AgentProvider } from "../../../shared/types"
import type { KannaState } from "../useKannaState"

interface ChatInputDockProps {
  inputRef: RefObject<HTMLDivElement | null>
  onLayoutChange: () => void
  chatInputRef: RefObject<ChatInputHandle | null>
  chatInputElementRef: RefObject<HTMLTextAreaElement | null>
  activeChatId: string | null
  previousPrompt: string | null
  hasSelectedProject: boolean
  canCancel: boolean
  projectId: string | null
  activeProvider: AgentProvider | null
  availableProviders: KannaState["availableProviders"]
  contextWindowSnapshot: ContextWindowSnapshot | null
  sessionTotals: SessionTotals | null
  onSubmit: KannaState["handleSend"]
  onCancel: () => void
}

export const ChatInputDock = memo(({
  inputRef,
  onLayoutChange,
  chatInputRef,
  chatInputElementRef,
  activeChatId,
  previousPrompt,
  hasSelectedProject,
  canCancel,
  projectId,
  activeProvider,
  availableProviders,
  contextWindowSnapshot,
  sessionTotals,
  onSubmit,
  onCancel,
}: ChatInputDockProps) => {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
      <div className="bg-gradient-to-t from-background via-background pointer-events-auto" ref={inputRef}>
        <ChatInput
          ref={chatInputRef}
          inputElementRef={chatInputElementRef}
          onLayoutChange={onLayoutChange}
          key={activeChatId ?? "new-chat"}
          onSubmit={onSubmit}
          onCancel={onCancel}
          disabled={!hasSelectedProject}
          canCancel={canCancel}
          chatId={activeChatId}
          projectId={projectId}
          activeProvider={activeProvider}
          availableProviders={availableProviders}
          contextWindowSnapshot={contextWindowSnapshot}
          sessionTotals={sessionTotals}
          previousPrompt={previousPrompt}
        />
      </div>
    </div>
  )
})
