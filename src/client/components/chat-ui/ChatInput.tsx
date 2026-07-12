import {
  forwardRef,
  memo,
  startTransition,
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
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { ArrowUp, Bot, Paperclip } from "lucide-react"

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
import { ScrollArea } from "../ui/scroll-area"
import { cn } from "../../lib/utils"
import { useIsStandalone } from "../../hooks/useIsStandalone"
import { useChatInputStore } from "../../stores/chatInputStore"
import {
  useComposerStore,
  type ComposerAttachment as StoreComposerAttachment,
} from "../../stores/composerStore"
import {
  NEW_CHAT_COMPOSER_ID,
  type ComposerState,
  useChatPreferencesStore,
} from "../../stores/chatPreferencesStore"
import { CHAT_INPUT_ATTRIBUTE } from "../../app/chatFocusPolicy"
import { ChatPreferenceControls } from "./ChatPreferenceControls"
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
import { uploadFile, UploadAbortedError } from "../../lib/uploadFile"
import { useAppSettingsStore, selectCustomModels, selectTextSnippets } from "../../stores/appSettingsStore"
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
import { serializeEditorToWire } from "../lexical/serialize/editorToWireString"
import { log } from "../../../shared/log"

// ---------------------------------------------------------------------------
// Clipboard helpers (exported — ChatInput.test.ts imports them)
// ---------------------------------------------------------------------------

const CLIPBOARD_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
}

type ClipboardFileItem = Pick<DataTransferItem, "kind" | "type" | "getAsFile">

function getClipboardImageExtension(file: File): string {
  return CLIPBOARD_EXTENSION_BY_MIME_TYPE[file.type] ?? "bin"
}

function isGenericClipboardImageName(file: File): boolean {
  const normalized = file.name.trim().toLowerCase()
  if (!normalized) return true
  const expectedExtension = getClipboardImageExtension(file)
  return normalized === `image.${expectedExtension}` || normalized === "image.png"
}

function normalizeClipboardImageFileFn(file: File, index: number, timestamp: number): File {
  if (file.name && !isGenericClipboardImageName(file)) return file
  const extension = getClipboardImageExtension(file)
  const suffix = index === 0 ? "" : `-${index}`
  const fileName = `clipboard-${timestamp}${suffix}.${extension}`
  Object.defineProperty(file, "name", {
    configurable: true,
    value: fileName,
  })
  return file
}

export function getClipboardImageFiles(
  items: Iterable<ClipboardFileItem>,
  timestamp: number,
): File[] {
  const files: File[] = []
  for (const item of items) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) continue
    const file = item.getAsFile()
    if (!file) continue
    files.push(normalizeClipboardImageFileFn(file, files.length, timestamp))
  }
  return files
}

export function trimTrailingPastedNewlines(text: string): string {
  return text.replace(/(?:\r\n|\r|\n)+$/, "")
}

export function willExceedAttachmentLimit(args: {
  currentAttachmentCount: number
  queuedAttachmentCount: number
  incomingAttachmentCount: number
  maxAttachments?: number
}): boolean {
  const maxAttachments = args.maxAttachments ?? MAX_FILES_PER_DROP
  return (
    args.currentAttachmentCount + args.queuedAttachmentCount + args.incomingAttachmentCount >
    maxAttachments
  )
}

// ---------------------------------------------------------------------------
// Touch-device helpers (exported — cursorJump test imports them)
// ---------------------------------------------------------------------------

export function isTouchDeviceEnvironment(): boolean {
  if (typeof window === "undefined") return false
  if ("ontouchstart" in window) return true
  const nav = typeof navigator !== "undefined" ? navigator : null
  return (nav?.maxTouchPoints ?? 0) > 0
}

/**
 * On touch devices, suppress caret-version bumps to avoid iOS Safari caret
 * jumps during the hold-space cursor-drag gesture.
 * No longer used for the textarea (Lexical handles selection internally),
 * but kept as an exported utility for back-compat with existing tests.
 */
export function shouldRefreshPickerOnSelection(isTouchDevice: boolean): boolean {
  return !isTouchDevice
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMPTY_SUBAGENTS: Subagent[] = []
const MAX_FILES_PER_DROP = 50
const MAX_CONCURRENT_UPLOADS = 3

// ---------------------------------------------------------------------------
// Attachment types — re-export from composerStore for local use
// ---------------------------------------------------------------------------

type ComposerAttachment = StoreComposerAttachment

// ---------------------------------------------------------------------------
// MentionChip type (for @agent/<name> chips row above editor)
// ---------------------------------------------------------------------------

type MentionChip =
  | { kind: "ok"; label: string; id: string }
  | { kind: "missing"; label: string }

// ---------------------------------------------------------------------------
// External Props (unchanged contract)
// ---------------------------------------------------------------------------

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
  /**
   * Kept for API back-compat. The Lexical editor uses a contenteditable div,
   * not a textarea. This ref is accepted but not connected to any DOM node.
   */
  inputElementRef?: React.Ref<HTMLTextAreaElement>
  activeProvider: AgentProvider | null
  availableProviders: ProviderCatalogEntry[]
  contextWindowSnapshot?: ContextWindowSnapshot | null
  sessionTotals?: SessionTotals | null
  previousPrompt?: string | null
}

export interface ChatInputHandle {
  enqueueFiles: (files: File[]) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function getEffectiveComposerState(
  composerState: ComposerState,
  activeProvider: AgentProvider | null,
  providerDefaults: ReturnType<typeof useChatPreferencesStore.getState>["providerDefaults"],
): ComposerState {
  if (!activeProvider || composerState.provider === activeProvider) {
    return composerState
  }
  return activeProvider === "claude"
    ? {
        provider: "claude",
        model: providerDefaults.claude.model,
        modelOptions: { ...providerDefaults.claude.modelOptions },
        planMode: composerState.planMode,
      }
    : {
        provider: "codex",
        model: providerDefaults.codex.model,
        modelOptions: { ...providerDefaults.codex.modelOptions },
        planMode: composerState.planMode,
      }
}

function hydrateComposerAttachments(attachments: ChatAttachment[]): ComposerAttachment[] {
  return attachments.map((attachment) => ({
    ...attachment,
    status: "uploaded" as const,
  }))
}

async function deleteUploadedAttachment(attachment: ChatAttachment): Promise<void> {
  if (!attachment.contentUrl) return
  const deleteUrl = attachment.contentUrl.replace(/\/content$/, "")
  await fetch(deleteUrl, { method: "DELETE" }).catch(() => undefined)
}

// ---------------------------------------------------------------------------
// LexicalEditorBridge – exposes imperative editor methods to parent
// ---------------------------------------------------------------------------

interface LexicalEditorBridgeHandle {
  /** Clear the editor to a single empty paragraph. */
  clearEditor: () => void
  /**
   * Hydrate the editor from a serialized state or fall back to plain text.
   * Prefer lexicalState; use text only if lexicalState is absent/invalid.
   */
  hydrateFromDraft: (lexicalState: SerializedEditorState | null, text: string | null) => void
  /**
   * Read the current wire payload synchronously.
   * Returns `{ text, attachments }` (the same shape as serializeEditorToWire).
   */
  readCurrentPayload: () => SubmitPayload
  /** Focus the editor. */
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
          } catch {
            // Fall through to plain-text hydration
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

// ---------------------------------------------------------------------------
// EditorEditabilityPlugin – syncs disabled→editable
// ---------------------------------------------------------------------------

function EditorEditabilityPlugin({ isDisabled }: { isDisabled: boolean }): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    editor.setEditable(!isDisabled)
  }, [editor, isDisabled])

  return null
}

// ---------------------------------------------------------------------------
// EditorTextTracker – derives live wire text for canSubmit / button state
// ---------------------------------------------------------------------------

function EditorTextTracker({
  onTextChange,
}: {
  onTextChange: (text: string) => void
}): null {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    // Fire once synchronously on mount to pick up any hydrated state
    const initial = serializeEditorToWire(editor)
    onTextChange(initial.text)

    return editor.registerUpdateListener(() => {
      const payload = serializeEditorToWire(editor)
      onTextChange(payload.text)
    })
  }, [editor, onTextChange])

  return null
}

// ---------------------------------------------------------------------------
// LexicalErrorBoundary – required by RichTextPlugin (ErrorBoundaryType compat)
// ---------------------------------------------------------------------------

function LexicalErrorBoundary({
  children,
  onError: _onError,
}: {
  children: React.ReactNode
  onError: (error: Error) => void
}): React.ReactNode {
  // Simple passthrough; Lexical will call onError on uncaught decorator errors.
  // Actual error propagation is handled by the kannaEditorOnError config hook.
  return children
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const ChatInputInner = forwardRef<ChatInputHandle, Props>((
  {
    onSubmit,
    onLayoutChange,
    onCancel,
    disabled,
    canCancel,
    chatId,
    projectId,
    // inputElementRef accepted for API compat but not connected to a DOM textarea
    inputElementRef: _inputElementRef,
    activeProvider,
    availableProviders,
    contextWindowSnapshot = null,
    sessionTotals = null,
    previousPrompt = null,
  },
  forwardedRef,
) => {
  const {
    getDraft,
    setDraft,
    clearDraft,
    getAttachmentDrafts,
    setAttachmentDrafts,
    clearAttachmentDrafts,
  } = useChatInputStore()
  const {
    providerDefaults,
    getComposerState,
    initializeComposerForChat,
    setChatComposerModel,
    setChatComposerPlanMode,
    resetChatComposerFromProvider,
  } = useChatPreferencesStore()

  const composerChatId = chatId ?? NEW_CHAT_COMPOSER_ID
  const storedComposerState = useChatPreferencesStore(
    (state) => state.chatStates[composerChatId],
  )
  const composerState = storedComposerState ?? getComposerState(composerChatId)
  const isStandalone = useIsStandalone()

  // ------ Composer store (replaces 5 useState calls) ------
  const attachments = useComposerStore((state) => state.attachments)
  const setAttachments = useComposerStore((state) => state.setAttachments)
  const selectedAttachmentId = useComposerStore((state) => state.selectedAttachmentId)
  const setSelectedAttachmentId = useComposerStore((state) => state.setSelectedAttachmentId)
  const uploadError = useComposerStore((state) => state.uploadError)
  const setUploadError = useComposerStore((state) => state.setUploadError)
  const currentText = useComposerStore((state) => state.currentText)
  const setCurrentText = useComposerStore((state) => state.setCurrentText)

  const uploadQueueRef = useRef<File[]>([])
  const activeUploadsRef = useRef(0)
  const attachmentsRef = useRef<ComposerAttachment[]>([])
  const uploadGenerationRef = useRef(0)
  const removedAttachmentIdsRef = useRef<Set<string>>(new Set())
  const previousProjectIdRef = useRef<string | null>(projectId ?? null)
  const latestChatIdRef = useRef<string | null>(chatId ?? null)

  // ------ Lexical bridge ref ------
  const bridgeRef = useRef<LexicalEditorBridgeHandle | null>(null)

  const providerPrefs = getEffectiveComposerState(composerState, activeProvider, providerDefaults)
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

  const uploadedAttachments = attachments.filter((a) => a.status === "uploaded")
  const hasPendingUploads = attachments.some((a) => a.status === "uploading")
  const hasTextToSend = currentText.trim().length > 0
  const canSubmit = currentText.trim().length > 0 || uploadedAttachments.length > 0
  const orderedAttachments = [...attachments].sort((left, right) => {
    if (left.kind === right.kind) return 0
    return left.kind === "image" ? -1 : 1
  })
  const selectedAttachment = attachments.find((a) => a.id === selectedAttachmentId) ?? null

  // ------ Subagent mention chips above the editor ------
  const subagentsForChips = useAppSettingsStore(
    (state) => state.settings?.subagents ?? EMPTY_SUBAGENTS,
  )
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
          ? { kind: "ok", label: hit.name, id: hit.id }
          : { kind: "missing", label: name },
      )
    }
    return chips
  }, [currentText, subagentsForChips])

  // ------ Attachment cleanup helpers ------
  const cleanupAttachmentPreview = useCallback((attachment: ComposerAttachment) => {
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl)
    }
  }, [])

  const clearAttachments = useCallback(
    (options?: { cleanupPreviews?: boolean }) => {
      const cleanupPreviews = options?.cleanupPreviews ?? true
      uploadGenerationRef.current += 1
      removedAttachmentIdsRef.current.clear()
      setAttachments((current) => {
        if (cleanupPreviews) {
          current.forEach(cleanupAttachmentPreview)
        }
        return []
      })
      uploadQueueRef.current = []
      activeUploadsRef.current = 0
      setSelectedAttachmentId(null)
      setUploadError(null)
    },
    [cleanupAttachmentPreview, setAttachments, setSelectedAttachmentId, setUploadError],
  )

  // ------ Upload queue ------
  // Ref breaks the self-reference cycle so the React Compiler can analyze this callback.
  const processUploadQueueRef = useRef<(() => void) | undefined>(undefined)
  const processUploadQueue = useCallback(() => {
    if (!projectId) return

    while (
      activeUploadsRef.current < MAX_CONCURRENT_UPLOADS &&
      uploadQueueRef.current.length > 0
    ) {
      const file = uploadQueueRef.current.shift()
      if (!file) break

      activeUploadsRef.current += 1
      const tempId = crypto.randomUUID()
      const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined
      const generation = uploadGenerationRef.current

      const handle = uploadFile({
        projectId,
        file,
        onProgress: ({ loaded, total }) => {
          if (generation !== uploadGenerationRef.current) return
          const progress = total > 0 ? loaded / total : 0
          setAttachments((current) =>
            current.map((a) => (a.id === tempId ? { ...a, uploadProgress: progress } : a)),
          )
        },
      })

      setAttachments((current) => [
        ...current,
        {
          id: tempId,
          kind: file.type.startsWith("image/") ? ("image" as const) : ("file" as const),
          displayName: file.name,
          absolutePath: "",
          relativePath: "",
          contentUrl: "",
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          status: "uploading" as const,
          previewUrl,
          uploadProgress: 0,
          cancelUpload: handle.abort,
        },
      ])

      void (async () => {
        try {
          const { attachments: uploaded } = await handle.promise
          const result = uploaded[0]
          if (!result) throw new Error("Upload failed")

          if (generation !== uploadGenerationRef.current) {
            void deleteUploadedAttachment(result)
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            return
          }

          if (removedAttachmentIdsRef.current.has(tempId)) {
            removedAttachmentIdsRef.current.delete(tempId)
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            void deleteUploadedAttachment(result)
            return
          }

          setAttachments((current) =>
            current.map((a) =>
              a.id !== tempId
                ? a
                : {
                    ...a,
                    ...result,
                    previewUrl: a.previewUrl,
                    status: "uploaded" as const,
                    uploadProgress: 1,
                    cancelUpload: undefined,
                  },
            ),
          )
          setUploadError(null)
        } catch (error) {
          if (generation !== uploadGenerationRef.current) {
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            return
          }
          if (error instanceof UploadAbortedError) {
            setAttachments((current) => current.filter((a) => a.id !== tempId))
            removedAttachmentIdsRef.current.delete(tempId)
            if (previewUrl) URL.revokeObjectURL(previewUrl)
            return
          }
          setAttachments((current) =>
            current.map((a) =>
              a.id === tempId
                ? { ...a, status: "failed" as const, cancelUpload: undefined }
                : a,
            ),
          )
          setUploadError(error instanceof Error ? error.message : String(error))
        } finally {
          activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1)
          processUploadQueueRef.current?.()
        }
      })()
    }
  }, [projectId, setAttachments, setUploadError])
  // Keep ref pointing to the latest version so the async IIFE can recurse without
  // capturing a stale closure.
  useEffect(() => {
    processUploadQueueRef.current = processUploadQueue
  }, [processUploadQueue])

  const enqueueFiles = useCallback(
    (files: File[]) => {
      if (!projectId) {
        setUploadError("Open a project before uploading files.")
        return
      }

      if (
        willExceedAttachmentLimit({
          currentAttachmentCount: attachmentsRef.current.length,
          queuedAttachmentCount: uploadQueueRef.current.length,
          incomingAttachmentCount: files.length,
        })
      ) {
        setUploadError(`You can upload up to ${MAX_FILES_PER_DROP} files at a time.`)
        return
      }

      uploadQueueRef.current.push(...files)
      setUploadError(null)
      processUploadQueue()
    },
    [processUploadQueue, projectId, setUploadError],
  )

  useImperativeHandle(
    forwardedRef,
    () => ({ enqueueFiles }),
    [enqueueFiles],
  )

  // ------ Core submit implementation ------
  const buildSubmitOptions = useCallback(() => {
    let modelOptions: ModelOptions
    if (providerPrefs.provider === "claude") {
      modelOptions = { claude: { ...providerPrefs.modelOptions } }
    } else {
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
      const previousAttachments = attachmentsRef.current
      const previousSelectedId = selectedAttachmentId
      const previousUploadError = uploadError

      const composerAttachmentsCopy = uploadedAttachments.map(
        ({ previewUrl: _p, status: _s, uploadProgress: _up, cancelUpload: _c, ...a }) => a,
      )
      const allAttachments = [...composerAttachmentsCopy, ...pluginAttachments]

      const submitOptions = { ...buildSubmitOptions(), attachments: allAttachments }

      // Eagerly clear
      bridgeRef.current?.clearEditor()
      setCurrentText("")
      if (chatId) clearDraft(chatId)
      clearAttachments({ cleanupPreviews: false })
      if (latestChatIdRef.current) clearAttachmentDrafts(latestChatIdRef.current)

      try {
        await onSubmit(text, submitOptions)
        previousAttachments.forEach(cleanupAttachmentPreview)
      } catch (error) {
        log.error("[ChatInput] Submit failed:", String(error))
        if (chatId) setDraft(chatId, text)
        setAttachments(previousAttachments)
        setSelectedAttachmentId(previousSelectedId)
        setUploadError(previousUploadError)
      }
    },
    [
      uploadedAttachments,
      buildSubmitOptions,
      chatId,
      clearDraft,
      clearAttachments,
      clearAttachmentDrafts,
      onSubmit,
      cleanupAttachmentPreview,
      selectedAttachmentId,
      uploadError,
      setDraft,
      setCurrentText,
      setAttachments,
      setSelectedAttachmentId,
      setUploadError,
    ],
  )

  // Called by SubmitPlugin (Enter key) — editor already cleared by the plugin
  const handlePluginSubmit = useCallback(
    async (payload: SubmitPayload) => {
      if (!canSubmit || hasPendingUploads) return
      await doSubmit(payload.text, payload.attachments)
    },
    [canSubmit, hasPendingUploads, doSubmit],
  )

  // Called by the Send button / onPointerDown
  const handleManualSubmit = useCallback(async () => {
    if (!canSubmit || hasPendingUploads) return
    const payload = bridgeRef.current?.readCurrentPayload() ?? { text: currentText, attachments: [] }
    await doSubmit(payload.text, payload.attachments)
  }, [canSubmit, hasPendingUploads, currentText, doSubmit])

  // ------ DraftPersistencePlugin onChange ------
  const handleDraftChange = useCallback(
    (state: SerializedEditorState, text: string) => {
      if (chatId) {
        // `text` from DraftPersistencePlugin is $getRoot().getTextContent(),
        // which includes MentionNode/SlashCommandNode text content.
        // We persist both the Lexical state (for full hydration) and the
        // plain text (for back-compat getDraft().text reads).
        setDraft(chatId, state, text)
      }
    },
    [chatId, setDraft],
  )

  // ------ Effects ------

  useEffect(() => {
    initializeComposerForChat(composerChatId, { providerHint: activeProvider })
  }, [composerChatId, initializeComposerForChat, activeProvider])

  useEffect(() => {
    latestChatIdRef.current = chatId ?? null
  }, [chatId])

  // Hydrate editor and focus when chatId changes (mirrors original textarea focus + draft effect)
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
    // Focus the editor whenever the chat changes (mirrors original autoFocus on chatId)
    bridgeRef.current?.focusEditor()
    // setCurrentText is handled by EditorTextTracker via registerUpdateListener.
    // We intentionally only re-run when chatId changes, not on every getDraft call.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId])

  useEffect(() => {
    uploadGenerationRef.current += 1
    uploadQueueRef.current = []
    activeUploadsRef.current = 0
    removedAttachmentIdsRef.current.clear()
    // Reset attachment selection and upload error when chatId changes.
    setSelectedAttachmentId(null)
    setUploadError(null)
    startTransition(() => {
      setAttachments((current) => {
        current.forEach(cleanupAttachmentPreview)
        return hydrateComposerAttachments(chatId ? getAttachmentDrafts(chatId) : [])
      })
    })
  }, [chatId, cleanupAttachmentPreview, getAttachmentDrafts, setSelectedAttachmentId, setUploadError, setAttachments])

  useEffect(() => {
    const previousProjectId = previousProjectIdRef.current
    previousProjectIdRef.current = projectId ?? null

    if (previousProjectId === null || projectId === previousProjectId) {
      return
    }

    clearAttachments()
    if (chatId) {
      clearAttachmentDrafts(chatId)
    }
  }, [projectId, chatId, clearAttachments, clearAttachmentDrafts])

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    if (!chatId) return

    const persistedAttachments = attachments
      .filter((a) => a.status === "uploaded")
      .map(
        ({
          previewUrl: _previewUrl,
          status: _status,
          uploadProgress: _uploadProgress,
          cancelUpload: _cancelUpload,
          ...attachment
        }) => attachment,
      )

    if (persistedAttachments.length === 0) {
      clearAttachmentDrafts(chatId)
      return
    }

    setAttachmentDrafts(chatId, persistedAttachments)
  }, [attachments, chatId, clearAttachmentDrafts, setAttachmentDrafts])

  useEffect(
    () => () => {
      attachmentsRef.current.forEach(cleanupAttachmentPreview)
    },
    [cleanupAttachmentPreview],
  )

  useLayoutEffect(() => {
    onLayoutChange?.()
  }, [onLayoutChange, attachments.length, uploadError, currentText])

  useEffect(() => {
    const handleResize = () => {
      onLayoutChange?.()
    }
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [onLayoutChange])

  // ------ Composer state helpers ------
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

  // ------ Attachment handlers ------
  function handleAttachmentPreview(attachment: ComposerAttachment) {
    const target = classifyAttachmentPreview(attachment)
    if (target.openInNewTab) {
      if (typeof window !== "undefined") {
        window.open(
          new URL(attachment.contentUrl, window.location.origin).toString(),
          "_blank",
          "noopener,noreferrer",
        )
      }
      return
    }
    setSelectedAttachmentId(attachment.id)
  }

  function removeAttachment(attachment: ComposerAttachment) {
    if (attachment.status === "uploading") {
      attachment.cancelUpload?.()
    }
    removedAttachmentIdsRef.current.add(attachment.id)
    setAttachments((current) => {
      const removed = current.find((item) => item.id === attachment.id)
      if (removed) cleanupAttachmentPreview(removed)
      return current.filter((item) => item.id !== attachment.id)
    })
    if (selectedAttachmentId === attachment.id) {
      setSelectedAttachmentId(null)
    }
    if (attachment.status === "uploaded") {
      removedAttachmentIdsRef.current.delete(attachment.id)
      void deleteUploadedAttachment(attachment)
    }
  }

  // ------ Keyboard: Escape, ShiftTab (plan mode), ArrowUp (previousPrompt) ------
  // The SubmitPlugin handles Enter. These keys need to be intercepted at the
  // wrapper div level since they affect state outside the editor.
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

  // ------ Upload error handler for plugins ------
  const handleUploadError = useCallback((msg: string) => {
    setUploadError(msg)
  }, [setUploadError])

  // ------ Editor config (memoized; LexicalComposer reads config only once) ------
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

  return (
    <div>
      <div className={cn("px-3 pt-0", isStandalone && "px-5")}>
        <div className="max-w-[840px] mx-auto rounded-[32px]">
          {/* @agent/<name> mention chips */}
          {mentionChips.length > 0 ? (
            <div className="flex flex-wrap gap-1 px-2 pt-2">
              {mentionChips.map((chip, i) => (
                <span
                  key={`${chip.kind}:${chip.label}:${i}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                    chip.kind === "ok"
                      ? "bg-accent text-accent-foreground"
                      : "bg-destructive/15 text-destructive",
                  )}
                >
                  <Bot className="h-3 w-3" />
                  agent/{chip.label}
                  {chip.kind === "missing" && (
                    <span className="ml-1 font-medium">unknown</span>
                  )}
                </span>
              ))}
            </div>
          ) : null}

          {/* Attachment strip */}
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
                        onRemove={() => removeAttachment(attachment)}
                        uploadProgress={
                          attachment.status === "uploading"
                            ? (attachment.uploadProgress ?? null)
                            : undefined
                        }
                        onCancelUpload={
                          attachment.status === "uploading"
                            ? () => removeAttachment(attachment)
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
                        onRemove={() => removeAttachment(attachment)}
                        uploadProgress={
                          attachment.status === "uploading"
                            ? (attachment.uploadProgress ?? null)
                            : undefined
                        }
                        onCancelUpload={
                          attachment.status === "uploading"
                            ? () => removeAttachment(attachment)
                            : undefined
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : null}

          {/* Input row */}
          <div
            className="relative flex items-end max-w-[840px] mx-auto border bg-background dark:bg-card/90 border-border rounded-[29px] pr-1.5 transition-colors focus-within:border-ring/60 focus-within:ring-2 focus-within:ring-ring/30"
            onKeyDown={handleKeyDown}
          >
            {/* Attachment button */}
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

            {/* Lexical editor */}
            <LexicalComposer initialConfig={editorConfig}>
              {/*
                CHAT_INPUT_ATTRIBUTE marks this element for the chatFocusPolicy.
                The original textarea carried it; now the contenteditable wrapper does.
              */}
              <div
                {...{ [CHAT_INPUT_ATTRIBUTE]: "" }}
                className="relative flex-1 min-w-0"
              >
                <RichTextPlugin
                  contentEditable={
                    <ContentEditable
                      placeholder={
                        <div className="pointer-events-none absolute top-3 left-3 md:top-4 md:left-6 text-muted-foreground text-base select-none">
                          Build something...
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
                <SlashCommandTypeaheadPlugin
                  chatId={chatId ?? null}
                  enabled={selectedProvider === "claude"}
                />
                <PasteImagePlugin projectId={projectId ?? null} onUploadError={handleUploadError} />
                <DropAttachmentPlugin projectId={projectId ?? null} onUploadError={handleUploadError} />
                <SnippetExpandPlugin snippets={textSnippets} />
                <SubmitPlugin onSubmit={handlePluginSubmit} disabled={disabled || hasPendingUploads} />
                <DraftPersistencePlugin onChange={handleDraftChange} />
                <LexicalEditorBridgePlugin bridgeRef={bridgeRef} />
                <EditorEditabilityPlugin isDisabled={disabled} />
                <EditorTextTracker onTextChange={setCurrentText} />
              </div>
            </LexicalComposer>

            {/* Send / Cancel button */}
            <Button
              type="button"
              onPointerDown={(event) => {
                event.preventDefault()
                if (!disabled && hasTextToSend && !hasPendingUploads) {
                  void handleManualSubmit()
                } else if (canCancel) {
                  onCancel?.()
                } else if (!disabled && canSubmit && !hasPendingUploads) {
                  void handleManualSubmit()
                }
              }}
              disabled={disabled || (!canCancel && !canSubmit) || hasPendingUploads}
              size="icon"
              aria-label={canCancel ? "Stop" : "Send message"}
              className="flex-shrink-0 bg-primary text-background rounded-full cursor-pointer h-11 w-11 mb-1 -mr-0.5 md:mr-0 md:mb-1.5 touch-manipulation disabled:opacity-50"
            >
              {canCancel && !hasTextToSend ? (
                <div className="w-3 h-3 md:w-4 md:h-4 rounded-xs bg-current" />
              ) : (
                <ArrowUp className="h-5 w-5 md:h-6 md:w-6" />
              )}
            </Button>
          </div>
        </div>

        {uploadError ? (
          <div className="max-w-[840px] mx-auto mt-2 px-1 text-sm text-destructive">
            {uploadError}
          </div>
        ) : null}
      </div>

      {/* Preference controls row */}
      <div className={cn("relative py-3 max-w-[840px] mx-auto", isStandalone && "p-5 pt-3")}>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden flex flex-row">
            <div className="min-w-3" />
            <ChatPreferenceControls
              availableProviders={availableProviders}
              selectedProvider={selectedProvider}
              showCodexCliRequirementHints
              model={providerPrefs.model}
              modelOptions={providerPrefs.modelOptions}
              onProviderChange={(provider) => {
                resetChatComposerFromProvider(composerChatId, provider)
              }}
              onModelChange={(_, model) => {
                setChatComposerModel(composerChatId, model)
              }}
              onModelOptionChange={(change) => {
                switch (change.type) {
                  case "claudeReasoningEffort":
                    setReasoningEffort(change.effort)
                    break
                  case "codexReasoningEffort":
                    setReasoningEffort(change.effort)
                    break
                  case "contextWindow":
                    setClaudeContextWindow(change.contextWindow)
                    break
                  case "fastMode":
                    updateComposerState((state) =>
                      state.provider === "claude" || state.provider === "openrouter"
                        ? state
                        : {
                            ...state,
                            modelOptions: {
                              ...state.modelOptions,
                              fastMode: change.fastMode,
                            },
                          },
                    )
                    break
                }
              }}
              planMode={providerPrefs.planMode}
              onPlanModeChange={setEffectivePlanMode}
              includePlanMode={showPlanMode}
              className="max-w-[840px] mx-auto"
            />
            <div className="min-w-3" />
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

      {/* File preview sheet */}
      <FilePreviewSheet
        source={
          selectedAttachment
            ? toPreviewSourceFromAttachment(selectedAttachment, "user_attachment")
            : null
        }
        open={selectedAttachment !== null}
        onOpenChange={(open) => !open && setSelectedAttachmentId(null)}
      />
    </div>
  )
})

export const ChatInput = memo(ChatInputInner)
