import { useEffect, useRef, useState } from "react"
import { ArrowDown, Flower } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import { ChatInput } from "../components/chat-ui/ChatInput"
import { ChatNavbar } from "../components/chat-ui/ChatNavbar"
import { TerminalWorkspace } from "../components/chat-ui/TerminalWorkspace"
import { ProcessingMessage } from "../components/messages/ProcessingMessage"
import { Card, CardContent } from "../components/ui/card"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../components/ui/resizable"
import { ScrollArea } from "../components/ui/scroll-area"
import { cn } from "../lib/utils"
import { DEFAULT_PROJECT_TERMINAL_LAYOUT, useTerminalLayoutStore } from "../stores/terminalLayoutStore"
import { useTerminalPreferencesStore } from "../stores/terminalPreferencesStore"
import type { KannaState } from "./useKannaState"
import { KannaTranscript } from "./KannaTranscript"
import { useStickyChatFocus } from "./useStickyChatFocus"

const EMPTY_STATE_TEXT = "What are we building?"
const EMPTY_STATE_TYPING_INTERVAL_MS = 19
const CHAT_NAVBAR_OFFSET_PX = 72

export function ChatPage() {
  const state = useOutletContext<KannaState>()
  const chatCardRef = useRef<HTMLDivElement>(null)
  const chatInputRef = useRef<HTMLTextAreaElement>(null)
  const [typedEmptyStateText, setTypedEmptyStateText] = useState("")
  const projectId = state.runtime?.projectId ?? null
  const projectTerminalLayout = useTerminalLayoutStore((store) => (projectId ? store.projects[projectId] : undefined))
  const terminalLayout = projectTerminalLayout ?? DEFAULT_PROJECT_TERMINAL_LAYOUT
  const addTerminal = useTerminalLayoutStore((store) => store.addTerminal)
  const removeTerminal = useTerminalLayoutStore((store) => store.removeTerminal)
  const toggleVisibility = useTerminalLayoutStore((store) => store.toggleVisibility)
  const setMainSizes = useTerminalLayoutStore((store) => store.setMainSizes)
  const setTerminalSizes = useTerminalLayoutStore((store) => store.setTerminalSizes)
  const scrollback = useTerminalPreferencesStore((store) => store.scrollbackLines)
  const minColumnWidth = useTerminalPreferencesStore((store) => store.minColumnWidth)

  const hasTerminals = terminalLayout.terminals.length > 0
  const showTerminalPane = Boolean(projectId && terminalLayout.isVisible && hasTerminals)

  useStickyChatFocus({
    rootRef: chatCardRef,
    fallbackRef: chatInputRef,
    enabled: state.hasSelectedProject && state.runtime?.status !== "waiting_for_user",
  })

  useEffect(() => {
    if (state.messages.length !== 0) return

    setTypedEmptyStateText("")

    let characterIndex = 0
    const interval = window.setInterval(() => {
      characterIndex += 1
      setTypedEmptyStateText(EMPTY_STATE_TEXT.slice(0, characterIndex))

      if (characterIndex >= EMPTY_STATE_TEXT.length) {
        window.clearInterval(interval)
      }
    }, EMPTY_STATE_TYPING_INTERVAL_MS)

    return () => window.clearInterval(interval)
  }, [state.activeChatId, state.messages.length])

  useEffect(() => {
    function handleToggleKeydown(event: KeyboardEvent) {
      if (!projectId) return
      if (!event.metaKey || event.key.toLowerCase() !== "j") return

      event.preventDefault()
      if (hasTerminals) {
        toggleVisibility(projectId)
        return
      }

      addTerminal(projectId)
    }

    window.addEventListener("keydown", handleToggleKeydown)
    return () => window.removeEventListener("keydown", handleToggleKeydown)
  }, [addTerminal, hasTerminals, projectId, toggleVisibility])

  useEffect(() => {
    if (state.messages.length === 0) return

    const frameId = window.requestAnimationFrame(() => {
      const element = state.scrollRef.current
      if (!element) return
      element.scrollTo({ top: element.scrollHeight, behavior: "auto" })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [showTerminalPane, state.messages.length, state.scrollRef])

  const chatCard = (
    <Card ref={chatCardRef} className="bg-background h-full flex flex-col overflow-hidden border-0 rounded-none relative">
      <CardContent className="flex flex-1 min-h-0 flex-col p-0 overflow-hidden relative">
        <ChatNavbar
          sidebarCollapsed={state.sidebarCollapsed}
          onOpenSidebar={state.openSidebar}
          onExpandSidebar={state.expandSidebar}
          onNewChat={state.handleCompose}
          localPath={state.navbarLocalPath}
          embeddedTerminalVisible={showTerminalPane}
          onToggleEmbeddedTerminal={projectId
            ? () => {
              if (hasTerminals) {
                toggleVisibility(projectId)
                return
              }
              addTerminal(projectId)
            }
            : undefined}
          onOpenExternal={(action) => {
            void state.handleOpenExternal(action)
          }}
        />

        <ScrollArea
          ref={state.scrollRef}
          onScroll={state.updateScrollState}
          className="flex-1 min-h-0 px-4 scroll-pt-[72px]"
        >
          {state.messages.length === 0 ? <div style={{ height: state.transcriptPaddingBottom }} aria-hidden="true" /> : null}
          {state.messages.length > 0 ? (
            <>
              <div className="animate-fade-in space-y-5 pt-[72px] max-w-[800px] mx-auto">
                <KannaTranscript
                  messages={state.messages}
                  isLoading={state.isProcessing}
                  localPath={state.runtime?.localPath}
                  latestToolIds={state.latestToolIds}
                  onAskUserQuestionSubmit={state.handleAskUserQuestion}
                  onExitPlanModeConfirm={state.handleExitPlanMode}
                />
                {state.isProcessing ? <ProcessingMessage status={state.runtime?.status} /> : null}
                {state.commandError ? (
                  <div className="text-sm text-destructive border border-destructive/20 bg-destructive/5 rounded-xl px-4 py-3">
                    {state.commandError}
                  </div>
                ) : null}
              </div>
              <div style={{ height: state.transcriptPaddingBottom + 96 }} aria-hidden="true" />
            </>
          ) : null}
        </ScrollArea>

        {state.messages.length === 0 ? (
          <div
            key={state.activeChatId ?? "new-chat"}
            className="pointer-events-none absolute inset-x-4 animate-fade-in"
            style={{
              top: CHAT_NAVBAR_OFFSET_PX,
              bottom: state.transcriptPaddingBottom,
            }}
          >
            <div className="mx-auto flex h-full max-w-[800px] items-center justify-center">
              <div className="flex flex-col items-center justify-center text-muted-foreground gap-4 opacity-70">
                <Flower strokeWidth={1.5} className="size-8 text-muted-foreground kanna-empty-state-flower"></Flower>
                <div
                  className="text-base font-normal text-muted-foreground text-center max-w-xs flex items-center kanna-empty-state-text"
                  aria-label={EMPTY_STATE_TEXT}
                >
                  <span className="relative inline-grid place-items-start">
                    <span className="invisible col-start-1 row-start-1 whitespace-pre flex items-center">
                      <span>{EMPTY_STATE_TEXT}</span>
                      <span className="kanna-typewriter-cursor-slot" aria-hidden="true" />
                    </span>
                    <span className="col-start-1 row-start-1 whitespace-pre flex items-center">
                      <span>{typedEmptyStateText}</span>
                      <span className="kanna-typewriter-cursor-slot" aria-hidden="true">
                        <span className="kanna-typewriter-cursor" />
                      </span>
                    </span>
                  </span>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div
          style={{ bottom: state.transcriptPaddingBottom - 36 }}
          className={cn(
            "absolute left-1/2 -translate-x-1/2 z-10 transition-all",
            state.showScrollButton
              ? "scale-100 duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
              : "scale-60 duration-300 ease-out pointer-events-none blur-sm opacity-0"
          )}
        >
          <button
            onClick={state.scrollToBottom}
            className="flex items-center transition-colors gap-1.5 px-2 bg-white hover:bg-muted border border-border rounded-full aspect-square cursor-pointer text-sm text-primary hover:text-foreground dark:bg-slate-700 dark:hover:bg-slate-600 dark:text-slate-100 dark:border-slate-600"
          >
            <ArrowDown className="h-5 w-5" />
          </button>
        </div>
      </CardContent>

      <div className="absolute bottom-0 left-0 right-0 z-20 pointer-events-none">
        <div className="bg-gradient-to-t from-background via-background pointer-events-auto" ref={state.inputRef}>
          <ChatInput
            ref={chatInputRef}
            key={state.activeChatId ?? "new-chat"}
            onSubmit={state.handleSend}
            onCancel={() => {
              void state.handleCancel()
            }}
            disabled={!state.hasSelectedProject || state.runtime?.status === "waiting_for_user"}
            canCancel={state.canCancel}
            chatId={state.activeChatId}
            activeProvider={state.runtime?.provider ?? null}
            availableProviders={state.availableProviders}
          />
        </div>
      </div>
    </Card>
  )

  return (
    <div className="flex-1 flex flex-col min-w-0 relative">
      {showTerminalPane && projectId ? (
        <ResizablePanelGroup
          key={projectId}
          orientation="vertical"
          className="flex-1 min-h-0"
          onLayoutChanged={(layout) => setMainSizes(projectId, [layout.chat, layout.terminal])}
        >
          <ResizablePanel id="chat" defaultSize={`${terminalLayout.mainSizes[0]}%`} minSize="25%" className="min-h-0">
            {chatCard}
          </ResizablePanel>
          <ResizableHandle withHandle orientation="vertical" />
          <ResizablePanel id="terminal" defaultSize={`${terminalLayout.mainSizes[1]}%`} minSize="0%" className="min-h-0">
            <TerminalWorkspace
              projectId={projectId}
              layout={terminalLayout}
              onAddTerminal={addTerminal}
              socket={state.socket}
              connectionStatus={state.connectionStatus}
              scrollback={scrollback}
              minColumnWidth={minColumnWidth}
              onRemoveTerminal={(currentProjectId, terminalId) => {
                void state.socket.command({ type: "terminal.close", terminalId }).catch(() => {})
                removeTerminal(currentProjectId, terminalId)
              }}
              onTerminalLayout={setTerminalSizes}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        chatCard
      )}

    </div>
  )
}
