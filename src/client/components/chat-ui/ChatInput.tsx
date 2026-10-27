import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react"
import type { SerializedEditorState } from "lexical"
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
} from "lexical"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { ArrowUp, Bot, Paperclip, Radio, SlidersHorizontal } from "lucide-react"

import {
  type AgentProvider,
  type ChatAttachment,
  type ClaudeContextWindow,
  type CustomModelEntry,
  type ModelOptions,
  type ProviderCatalogEntry,
  type Subagent,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  normalizeClaudeContextWindow,
  resolveClaudeContextWindowTokens,
} from "../../../shared/types"
import { Button } from "../ui/button"
import { Spinner } from "../ui/spinner"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog"
import { Kbd } from "../ui/kbd"
import { ScrollArea } from "../ui/scroll-area"
import { cn } from "../../lib/utils"
import { useIsStandalone } from "../../hooks/useIsStandalone"
import { useChatInputStore } from "../../stores/chatInputStore"
import {
  ChatTabScopedStore,
  type ComposerAttachment as StoreComposerAttachment,
} from "../../stores/chatTabScopedStore"
import {
  NEW_CHAT_COMPOSER_ID,
  type ComposerState,
  useChatPreferencesStore,
} from "../../stores/chatPreferencesStore"
import { useComposerArrival } from "./ComposerArrival"
import { useComposerUploads } from "./useComposerUploads"
import { CHAT_INPUT_ATTRIBUTE } from "../../app/chatFocusPolicy"
import { ChatPreferenceControls, type ModelLock } from "./ChatPreferenceControls"
import { ContextWindowMeter } from "./ContextWindowMeter"
import { SessionTokenPill } from "./SessionTokenPill"
import { AttachmentFileCard, AttachmentImageCard } from "../messages/AttachmentCard"
import { FilePreviewSheet } from "../messages/file-preview/FilePreviewSheet"
import { toPreviewSourceFromAttachment } from "../messages/file-preview/types"
import { classifyAttachmentPreview } from "../messages/attachmentPreview"
import {
  overrideContextWindowMaxTokens,
  type ContextWindowSnapshot,
  type SessionTotals,
} from "../../lib/contextWindow"
import { useAppSettingsStore, selectCustomBeacons, selectCustomModels, selectTextSnippets } from "../../stores/appSettingsStore"
import { createAgentMentionRegex } from "../../../shared/mention-pattern"

import { buildKannaEditorConfig } from "../lexical/config"
import { KANNA_COMPOSER_NODES } from "../lexical/nodes"
import {
  MentionTypeaheadPlugin,
  SlashCommandTypeaheadPlugin,
  PasteImagePlugin,
  DropAttachmentPlugin,
  SubmitPlugin,
  DraftPersistencePlugin,
  SnippetExpandPlugin,
  type SubmitPayload,
} from "../lexical/plugins"
import { useInlineUploadsPending } from "../lexical/plugins/inlineUploadPending"
import { serializeEditorToWire } from "../lexical/serialize/editorToWireString"
import { log } from "../../../shared/log"
import { beaconMentionChips } from "../../lib/beaconMentionChips"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../stores/pendingActionsStore"
import type { DomPort } from "../../ports/domPort"
import type { CommandPort } from "../../ports/commandPort"
import { domAdapter } from "../../adapters/dom.adapter"
import { useOptionalKannaSocket } from "../../app/KannaSocketProvider"


export function isStopAffordance(canCancel: boolean, hasTextToSend: boolean): boolean {
  return canCancel && !hasTextToSend
}

const EMPTY_SUBAGENTS: Subagent[] = []
const CRON_MODEL_LOCK: ModelLock = {
  reason: "Model is locked while a cron job is running — pause or remove the cron job to change it",
}


type ComposerAttachment = StoreComposerAttachment


type MentionChip =
  | { kind: "ok"; family: "agent" | "beacon"; label: string; id: string }
  | { kind: "missing"; family: "agent" | "beacon"; label: string }


export interface ChatInputPorts {
  dom?: DomPort
  commands?: CommandPort
}

interface Props {
  onSubmit: (
    value: string,
    options?: {
      provider?: AgentProvider
      model?: string
      modelOptions?: ModelOptions
      planMode?: boolean
      attachments?: ChatAttachment[]
    },
  ) => Promise<void>
  onLayoutChange?: () => void
  onCancel?: () => void
  disabled: boolean
  canCancel?: boolean
  chatId?: string | null
  projectId?: string | null
  inputElementRef?: React.Ref<HTMLTextAreaElement>
  activeProvider: AgentProvider | null
  availableProviders: ProviderCatalogEntry[]
  contextWindowSnapshot?: ContextWindowSnapshot | null
  sessionTotals?: SessionTotals | null
  previousPrompt?: string | null
  ports?: ChatInputPorts
  hasUnpausedCronJob?: boolean
}

export interface ChatInputHandle {
  enqueueFiles: (files: File[]) => void
  focus: () => void
}


function withNormalizedContextWindow(
  state: ComposerState,
  model: string,
  customModels?: readonly CustomModelEntry[],
): ComposerState {
  if (state.provider !== "claude") return { ...state, model }
  return {
    ...state,
    model,
    modelOptions: {
      ...state.modelOptions,
      contextWindow: normalizeClaudeContextWindow(model, state.modelOptions.contextWindow, customModels),
    },
  }
}

interface LexicalEditorBridgeHandle {
  clearEditor: () => void
  hydrateFromDraft: (lexicalState: SerializedEditorState | null, text: string | null) => void
  readCurrentPayload: () => SubmitPayload
  focusEditor: () => void
}

function LexicalEditorBridgePlugin({
  bridgeRef,
}: {
  bridgeRef: RefObject<LexicalEditorBridgeHandle | null>
}): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    bridgeRef.current = {
      clearEditor: () => {
        editor.update(() => {
          const root = $getRoot()
          root.clear()
          root.append($createParagraphNode())
        })
      },

      hydrateFromDraft: (lexicalState: SerializedEditorState | null, text: string | null) => {
        if (lexicalState) {
          try {
            const parsed = editor.parseEditorState(lexicalState)
            editor.setEditorState(parsed)
            return
          } catch (error) {
            log.error("[ChatInput] Draft restore failed, falling back to plain text:", String(error))
          }
        }
        if (text) {
          editor.update(() => {
            const root = $getRoot()
            root.clear()
            const para = $createParagraphNode()
            para.append($createTextNode(text))
            root.append(para)
          })
        } else {
          editor.update(() => {
            const root = $getRoot()
            root.clear()
            root.append($createParagraphNode())
          })
        }
      },

      readCurrentPayload: () => serializeEditorToWire(editor),

      focusEditor: () => {
        editor.focus()
      },
    }

    return () => {
      bridgeRef.current = null
    }
  }, [editor, bridgeRef])

  return null
}


function EditorEditabilityPlugin({ isDisabled }: { isDisabled: boolean }): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.setEditable(!isDisabled)
  }, [editor, isDisabled])

  return null
}


function EditorTextTracker({
  onTextChange,
}: {
  onTextChange: (text: string) => void
}): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    const initial = serializeEditorToWire(editor)
    onTextChange(initial.text)

    return editor.registerUpdateListener(() => {
      const payload = serializeEditorToWire(editor)
      onTextChange(payload.text)
    })
  }, [editor, onTextChange])

  return null
}


const ChatInputInner = forwardRef<ChatInputHandle, Props>((
  {
    onSubmit,
    onLayoutChange,
    onCancel,
    disabled,
    canCancel,
    chatId,
    projectId,
    inputElementRef: _inputElementRef,
    activeProvider,
    availableProviders,
    contextWindowSnapshot = null,
    sessionTotals = null,
    previousPrompt = null,
    ports,
    hasUnpausedCronJob = false,
  },
  forwardedRef,
) => {
  const dom = ports?.dom ?? domAdapter
  const socket = useOptionalKannaSocket()
  const commands = ports?.commands ?? socket
  const {
    getDraft,
    setDraft,
    clearDraft,
  } = useChatInputStore()
  const {
    getComposerState,
    initializeComposerForChat,
    setChatComposerModel,
    setChatComposerPlanMode,
    resetChatComposerFromProvider,
  } = useChatPreferencesStore()

  const composerChatId = chatId ?? NEW_CHAT_COMPOSER_ID
  const composerArrival = useComposerArrival(chatId ?? null)
  const storedComposerState = useChatPreferencesStore(
    (state) => state.chatStates[composerChatId],
  )
  const composerState = storedComposerState ?? getComposerState(composerChatId)
  const isStandalone = useIsStandalone()

  const currentText = ChatTabScopedStore.useScopedStore((state) => state.currentText)
  const setCurrentText = ChatTabScopedStore.useScopedStore((state) => state.setCurrentText)
  const chatSettingsOpen = ChatTabScopedStore.useScopedStore((state) => state.chatSettingsOpen)
  const setChatSettingsOpen = ChatTabScopedStore.useScopedStore((state) => state.setChatSettingsOpen)

  const uploads = useComposerUploads({ projectId: projectId ?? null, chatId: chatId ?? null, commands })
  const {
    attachments,
    uploadError,
    setUploadError,
    selectedAttachment,
    selectAttachment,
    enqueue: enqueueFiles,
    beginSubmit,
  } = uploads
  const chatSettingsTriggerRef = useRef<HTMLButtonElement>(null)

  const bridgeRef = useRef<LexicalEditorBridgeHandle | null>(null)

  const providerPrefs = composerState
  const selectedProvider = composerState.provider
  const customModels = useAppSettingsStore(selectCustomModels)
  const textSnippets = useAppSettingsStore(selectTextSnippets)

  const fileInputRef = useRef<HTMLInputElement>(null)

  const providerConfig =
    availableProviders.find((provider) => provider.id === selectedProvider) ?? availableProviders[0]
  const showPlanMode = providerConfig?.supportsPlanMode ?? false

  const activeContextWindow = useMemo(() => {
    if (providerPrefs.provider !== "claude") {
      return contextWindowSnapshot
    }
    const { modelOptions: claudeModelOptions } = providerPrefs
    const stagedMaxTokens = resolveClaudeContextWindowTokens(
      normalizeClaudeContextWindow(providerPrefs.model, claudeModelOptions.contextWindow, customModels),
    )
    return overrideContextWindowMaxTokens(contextWindowSnapshot, stagedMaxTokens)
  }, [
    contextWindowSnapshot,
    customModels,
    providerPrefs,
  ])

  const inlineUploadsPending = useInlineUploadsPending(composerChatId)
  const hasPendingUploads = inlineUploadsPending || uploads.isUploading
  const submitActionKey = pendingActionKey("chat.send", composerChatId)
  const submitPending = usePendingAction(submitActionKey)
  const cancelPending = usePendingAction(pendingActionKey("chat.cancel", chatId ?? ""))
  const hasTextToSend = currentText.trim().length > 0
  const canSubmit = currentText.trim().length > 0 || uploads.hasUploadedAttachments
  const orderedAttachments = [...attachments].sort((left, right) => {
    if (left.kind === right.kind) return 0
    return left.kind === "image" ? -1 : 1
  })

  const subagentsForChips = useAppSettingsStore(
    (state) => state.settings?.subagents ?? EMPTY_SUBAGENTS,
  )
  const beaconsForChips = useAppSettingsStore(selectCustomBeacons)
  const mentionChips = useMemo<MentionChip[]>(() => {
    const byNameLower = new Map(
      subagentsForChips.map((subagent) => [subagent.name.toLowerCase(), subagent]),
    )
    const matches = [...currentText.matchAll(createAgentMentionRegex())]
    const chips: MentionChip[] = []
    for (const match of matches) {
      const name = match[2]
      if (!name) continue
      const hit = byNameLower.get(name.toLowerCase())
      chips.push(
        hit
          ? { kind: "ok", family: "agent", label: hit.name, id: hit.id }
          : { kind: "missing", family: "agent", label: name },
      )
    }
    for (const chip of beaconMentionChips(currentText, beaconsForChips)) {
      chips.push({ ...chip, family: "beacon" })
    }
    return chips
  }, [currentText, subagentsForChips, beaconsForChips])

  useImperativeHandle(
    forwardedRef,
    () => ({ enqueueFiles, focus: () => bridgeRef.current?.focusEditor() }),
    [enqueueFiles],
  )

  const buildSubmitOptions = useCallback(() => {
    let modelOptions: ModelOptions = {}
    if (providerPrefs.provider === "claude") {
      modelOptions = { claude: { ...providerPrefs.modelOptions } }
    } else if (providerPrefs.provider === "codex") {
      modelOptions = { codex: { ...providerPrefs.modelOptions } }
    }
    return {
      provider: selectedProvider,
      model: providerPrefs.model,
      modelOptions,
      planMode: showPlanMode ? providerPrefs.planMode : false,
    }
  }, [providerPrefs, selectedProvider, showPlanMode])

  const doSubmit = useCallback(
    async (text: string, pluginAttachments: ChatAttachment[]) => {
      const submission = beginSubmit()
      const submitOptions = {
        ...buildSubmitOptions(),
        attachments: [...submission.attachments, ...pluginAttachments],
      }

      bridgeRef.current?.clearEditor()
      setCurrentText("")
      if (chatId) clearDraft(chatId)

      try {
        await onSubmit(text, submitOptions)
        submission.commit()
      } catch (error) {
        log.error("[ChatInput] Submit failed:", String(error))
        if (chatId) setDraft(chatId, text)
        submission.rollback()
      }
    },
    [beginSubmit, buildSubmitOptions, chatId, clearDraft, onSubmit, setDraft, setCurrentText],
  )

  const handlePluginSubmit = useCallback(
    (payload: SubmitPayload) => {
      if (!canSubmit || hasPendingUploads) return
      runPendingAction(submitActionKey, () => doSubmit(payload.text, payload.attachments))
    },
    [canSubmit, hasPendingUploads, doSubmit, submitActionKey],
  )

  const handleManualSubmit = useCallback(() => {
    if (!canSubmit || hasPendingUploads) return
    const payload = bridgeRef.current?.readCurrentPayload() ?? { text: currentText, attachments: [] }
    runPendingAction(submitActionKey, () => doSubmit(payload.text, payload.attachments))
  }, [canSubmit, hasPendingUploads, currentText, doSubmit, submitActionKey])

  const handleDraftChange = useCallback(
    (state: SerializedEditorState, text: string) => {
      if (chatId) {
        setDraft(chatId, state, text)
      }
    },
    [chatId, setDraft],
  )


  useEffect(() => {
    initializeComposerForChat(composerChatId, { providerHint: activeProvider })
  }, [composerChatId, initializeComposerForChat, activeProvider])

  useEffect(() => {
    if (!chatId) {
      bridgeRef.current?.clearEditor()
    } else {
      const draft = getDraft(chatId)
      if (draft) {
        bridgeRef.current?.hydrateFromDraft(draft.lexicalState ?? null, draft.text)
      } else {
        bridgeRef.current?.clearEditor()
      }
    }
    bridgeRef.current?.focusEditor()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  useLayoutEffect(() => {
    onLayoutChange?.()
  }, [onLayoutChange, attachments.length, uploadError, currentText])

  useEffect(() => {
    const handleResize = () => {
      onLayoutChange?.()
    }
    return dom.addWindowListener("resize", handleResize)
  }, [dom, onLayoutChange])

  function updateComposerState(transform: (state: ComposerState) => ComposerState) {
    useChatPreferencesStore.getState().setComposerState(composerChatId, transform(providerPrefs))
  }

  function setReasoningEffort(reasoningEffort: string) {
    updateComposerState((state): ComposerState => {
      if (state.provider === "claude" && isClaudeReasoningEffort(reasoningEffort)) {
        return { ...state, modelOptions: { ...state.modelOptions, reasoningEffort } }
      }
      if (state.provider === "codex" && isCodexReasoningEffort(reasoningEffort)) {
        return { ...state, modelOptions: { ...state.modelOptions, reasoningEffort } }
      }
      return state
    })
  }

  function setClaudeContextWindow(contextWindow: ClaudeContextWindow) {
    updateComposerState((state) =>
      state.provider !== "claude"
        ? state
        : withNormalizedContextWindow(
            { ...state, modelOptions: { ...state.modelOptions, contextWindow } },
            state.model,
            customModels,
          ),
    )
  }

  function setEffectivePlanMode(planMode: boolean) {
    setChatComposerPlanMode(composerChatId, planMode)
  }

  function toggleEffectivePlanMode() {
    setEffectivePlanMode(!providerPrefs.planMode)
  }

  function handleAttachmentPreview(attachment: ComposerAttachment) {
    const target = classifyAttachmentPreview(attachment)
    if (target.openInNewTab) {
      dom.openWindow(
        new URL(attachment.contentUrl, dom.getOrigin()).toString(),
        "_blank",
        "noopener,noreferrer",
      )
      return
    }
    selectAttachment(attachment.id)
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.nativeEvent.isComposing) return

    if (event.key === "Tab" && event.shiftKey && showPlanMode) {
      event.preventDefault()
      toggleEffectivePlanMode()
      return
    }

    if (event.key === "Escape" && canCancel) {
      event.preventDefault()
      onCancel?.()
      return
    }

    if (
      event.key === "ArrowUp" &&
      !event.shiftKey &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      currentText.length === 0 &&
      previousPrompt
    ) {
      event.preventDefault()
      bridgeRef.current?.hydrateFromDraft(null, previousPrompt)
      setCurrentText(previousPrompt)
      if (chatId) setDraft(chatId, previousPrompt)
      
    }
  }

  const handleUploadError = useCallback((msg: string) => {
    setUploadError(msg)
  }, [setUploadError])

  const editorConfig = useMemo(
    () =>
      buildKannaEditorConfig({
        namespace: `kanna-composer-${composerChatId}`,
        nodes: [...KANNA_COMPOSER_NODES],
        editable: !disabled,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [composerChatId],
  )

  function renderPreferenceControls(className: string) {
    return (
      <ChatPreferenceControls
        availableProviders={availableProviders}
        selectedProvider={selectedProvider}
        model={providerPrefs.model}
        modelOptions={providerPrefs.modelOptions}
        onProviderChange={(provider) => resetChatComposerFromProvider(composerChatId, provider)}
        onModelChange={(_, model) => setChatComposerModel(composerChatId, model)}
        modelLock={hasUnpausedCronJob ? CRON_MODEL_LOCK : null}
        onModelOptionChange={(change) => {
          switch (change.type) {
            case "claudeReasoningEffort":
            case "codexReasoningEffort":
              setReasoningEffort(change.effort)
              break
            case "contextWindow":
              setClaudeContextWindow(change.contextWindow)
              break
            case "fastMode":
              updateComposerState((state) => state.provider === "codex"
                ? { ...state, modelOptions: { ...state.modelOptions, fastMode: change.fastMode } }
                : state)
              break
          }
        }}
        planMode={providerPrefs.planMode}
        onPlanModeChange={setEffectivePlanMode}
        includePlanMode={showPlanMode}
        className={className}
      />
    )
  }

  return (
    <div>
      <div className={cn("px-3 pt-0", isStandalone && "px-5")}>
        <div className="max-w-[840px] mx-auto">
          {mentionChips.length > 0 ? (
            <div className="flex flex-wrap gap-1 px-2 pt-2">
              {mentionChips.map((chip, i) => (
                <span
                  key={`${chip.family}:${chip.kind}:${chip.label}:${i}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                    chip.kind === "ok"
                      ? "bg-accent text-accent-foreground"
                      : "bg-destructive/15 text-destructive",
                  )}
                >
                  {chip.family === "beacon" ? <Radio className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                  {chip.family}/{chip.label}
                  {chip.kind === "missing" && (
                    <span className="ml-1 font-medium">unknown</span>
                  )}
                </span>
              ))}
            </div>
          ) : null}

          {attachments.length > 0 ? (
            <ScrollArea className="overflow-x-auto overflow-y-hidden whitespace-nowrap px-2 pb-2">
              <div className="flex items-end gap-2 pt-2">
                {orderedAttachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className={cn(
                      "flex shrink-0 flex-col justify-end",
                      attachment.status === "failed" && "text-destructive",
                    )}
                  >
                    {attachment.kind === "image" ? (
                      <AttachmentImageCard
                        attachment={attachment}
                        previewUrl={attachment.previewUrl}
                        size="composer"
                        onClick={
                          attachment.status === "uploaded"
                            ? () => handleAttachmentPreview(attachment)
                            : undefined
                        }
                        onRemove={() => uploads.remove(attachment)}
                        uploadProgress={
                          attachment.status === "uploading"
                            ? (attachment.uploadProgress ?? null)
                            : undefined
                        }
                        onCancelUpload={
                          attachment.status === "uploading"
                            ? () => uploads.remove(attachment)
                            : undefined
                        }
                      />
                    ) : (
                      <AttachmentFileCard
                        attachment={attachment}
                        onClick={
                          attachment.status === "uploaded" && attachment.contentUrl
                            ? () => handleAttachmentPreview(attachment)
                            : undefined
                        }
                        onRemove={() => uploads.remove(attachment)}
                        uploadProgress={
                          attachment.status === "uploading"
                            ? (attachment.uploadProgress ?? null)
                            : undefined
                        }
                        onCancelUpload={
                          attachment.status === "uploading"
                            ? () => uploads.remove(attachment)
                            : undefined
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : null}

          <div
            className={cn("relative flex items-end max-w-[840px] mx-auto rounded-xl border border-border bg-background pr-1.5 transition-colors focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/30 dark:bg-card/90", composerArrival.className)}
            onKeyDown={handleKeyDown}
          >
            {composerArrival.sweep}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Add attachment"
              disabled={disabled}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => fileInputRef.current?.click()}
              className="relative flex-shrink-0 ml-1 mb-1 h-11 w-11 rounded-full text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              disabled={disabled}
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
              onChange={(event) => {
                const files = [...(event.target.files ?? [])]
                if (files.length > 0) {
                  enqueueFiles(files)
                }
                event.target.value = ""
              }}
            />

            <LexicalComposer initialConfig={editorConfig}>
              <div
                {...{ [CHAT_INPUT_ATTRIBUTE]: "" }}
                className="relative flex-1 min-w-0"
              >
                <RichTextPlugin
                  contentEditable={
                    <ContentEditable
                      placeholder={
                        <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 text-base text-muted-foreground select-none md:top-4 md:left-6">
                          <span>Build something...</span>
                          {previousPrompt ? (
                            <span className="hidden md:inline-flex items-center gap-1 text-xs">
                              <Kbd className="h-4 min-w-4 rounded-sm border-border/50 bg-transparent px-1 text-xs">↑</Kbd>
                              Edit last message
                            </span>
                          ) : null}
                        </div>
                      }
                      className="flex-1 text-base p-3 md:p-4 !pr-2 pl-3 md:pl-6 min-h-[44px] max-h-[200px] outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 bg-transparent border-0 shadow-none overflow-auto"
                      aria-label="Chat input"
                      aria-placeholder="Build something..."
                      aria-multiline="true"
                      role="textbox"
                    />
                  }
                  ErrorBoundary={LexicalErrorBoundary}
                />
                <HistoryPlugin />
                <MentionTypeaheadPlugin projectId={projectId ?? null} />
                <SlashCommandTypeaheadPlugin projectId={projectId ?? null} />
                <PasteImagePlugin projectId={projectId ?? null} uploadOwnerId={composerChatId} onUploadError={handleUploadError} />
                <DropAttachmentPlugin projectId={projectId ?? null} uploadOwnerId={composerChatId} onUploadError={handleUploadError} />
                <SnippetExpandPlugin snippets={textSnippets} />
                <SubmitPlugin onSubmit={handlePluginSubmit} disabled={disabled || hasPendingUploads || submitPending} />
                <DraftPersistencePlugin onChange={handleDraftChange} />
                <LexicalEditorBridgePlugin bridgeRef={bridgeRef} />
                <EditorEditabilityPlugin isDisabled={disabled} />
                <EditorTextTracker onTextChange={setCurrentText} />
              </div>
            </LexicalComposer>

            <Button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault()
                if (!disabled && hasTextToSend && !hasPendingUploads) {
                  handleManualSubmit()
                } else if (canCancel) {
                  onCancel?.()
                } else if (!disabled && canSubmit && !hasPendingUploads) {
                  handleManualSubmit()
                }
              }}
              disabled={disabled || (!canCancel && !canSubmit) || hasPendingUploads}
              pending={submitPending || cancelPending}
              size="icon"
              aria-label={isStopAffordance(Boolean(canCancel), hasTextToSend) ? "Stop" : "Send message"}
              className="flex-shrink-0 bg-primary text-background rounded-full cursor-pointer h-11 w-11 mb-1 -mr-0.5 md:mr-0 md:mb-1.5 touch-manipulation disabled:opacity-50"
            >
              {isStopAffordance(Boolean(canCancel), hasTextToSend) ? (
                <div className="w-3 h-3 md:w-4 md:h-4 rounded-xs bg-current" />
              ) : (
                <ArrowUp className="h-5 w-5 md:h-6 md:w-6" />
              )}
            </Button>
          </div>
        </div>

        {inlineUploadsPending ? (
          <div role="status" className="max-w-[840px] mx-auto mt-2 px-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <Spinner />
            Uploading attachment…
          </div>
        ) : null}

        {uploadError ? (
          <div className="max-w-[840px] mx-auto mt-2 px-1 text-sm text-destructive">
            {uploadError}
          </div>
        ) : null}
      </div>

      <div className={cn("relative py-3 max-w-[840px] mx-auto", isStandalone && "p-5 pt-3")}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="hidden md:block">{renderPreferenceControls("mx-auto max-w-[840px]")}</div>
            <Dialog open={chatSettingsOpen} onOpenChange={setChatSettingsOpen}>
              <Button
                ref={chatSettingsTriggerRef}
                variant="outline"
                size="default"
                className="ml-3 md:hidden"
                onClick={() => setChatSettingsOpen(true)}
                aria-haspopup="dialog"
              >
                <SlidersHorizontal className="size-4" />
                Chat settings
              </Button>
              <DialogContent
                size="sm"
                restoreFocus="trigger"
                onCloseAutoFocus={(event) => {
                  event.preventDefault()
                  chatSettingsTriggerRef.current?.focus({ preventScroll: true })
                }}
              >
                <DialogHeader>
                  <DialogTitle>Chat settings</DialogTitle>
                  <DialogDescription>Choose the provider, model, reasoning, context, and permission mode for this chat.</DialogDescription>
                </DialogHeader>
                <DialogBody>{renderPreferenceControls("flex-wrap justify-start gap-2")}</DialogBody>
              </DialogContent>
            </Dialog>
          </div>

          {(sessionTotals ?? activeContextWindow) ? (
            <div className="hidden shrink-0 items-center gap-2 pr-3 md:flex">
              <SessionTokenPill totals={sessionTotals ?? null} />
              {activeContextWindow ? <ContextWindowMeter usage={activeContextWindow} /> : null}
            </div>
          ) : null}
        </div>

        {(sessionTotals ?? activeContextWindow) ? (
          <div className="flex md:hidden items-center justify-end gap-2 px-[13px] pt-2">
            <SessionTokenPill totals={sessionTotals ?? null} />
            {activeContextWindow ? <ContextWindowMeter usage={activeContextWindow} /> : null}
          </div>
        ) : null}
      </div>

      <FilePreviewSheet
        source={
          selectedAttachment
            ? toPreviewSourceFromAttachment(selectedAttachment, "user_attachment")
            : null
        }
        open={selectedAttachment !== null}
        onOpenChange={(open) => !open && selectAttachment(null)}
      />
    </div>
  )
})

export const ChatInput = memo(ChatInputInner)
