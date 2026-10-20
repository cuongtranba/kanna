import { useCallback, useMemo, type ChangeEvent } from "react"
import type { SidebarData } from "../../shared/types"
import type { WebhookInput, WebhookMode, WebhookPatch, WebhookSummary } from "../../shared/webhooks/types"
import { validateWebhookInput, validateWebhookModel } from "../../shared/webhooks/validate"
import { Button } from "../components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { SearchableSelect } from "../components/ui/searchable-select"
import { SegmentedControl, type SegmentedOption } from "../components/ui/segmented-control"
import { Textarea } from "../components/ui/textarea"
import { webhookModeConsequence, webhookModeLabel } from "../lib/webhookPresentation"
import { decodeWebhookModel, listWebhookModelOptions, listWebhookTargets } from "../lib/webhookTargets"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useWebhooksStore } from "../stores/webhooksStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"
import { useProviderCatalog } from "./useProviderCatalog"
import { sendWebhookCommand } from "./webhookCommands"
import { WebhookCreateStore } from "./WebhookCreateDialog.store"
import { WebhookTargetSelect } from "./WebhookTargetSelect"

interface Props {
  sidebarData: SidebarData
  onCreate: (input: WebhookInput) => Promise<void>
}

interface FormProps extends Props {
  editing: WebhookSummary | undefined
}

const CREATE_KEY = pendingActionKey("webhooks.create")

const FILTER_PLACEHOLDER = `on:
  issues:
    types: [assigned]
if: body.assignee.login == "octocat"`

const MODE_OPTIONS: SegmentedOption<WebhookMode>[] = (["notify", "inline", "spawn"] as const).map((mode) => ({
  value: mode,
  label: webhookModeLabel(mode),
}))

function WebhookEditorForm({ sidebarData, onCreate, editing }: FormProps) {
  const socket = useOptionalKannaSocket()
  const catalog = useProviderCatalog()
  const submitKey = editing ? pendingActionKey("webhooks.update", editing.id) : CREATE_KEY
  const pending = usePendingAction(submitKey)
  const closeEditor = useWebhooksStore((state) => state.closeEditor)
  const name = WebhookCreateStore.useScopedStore((state) => state.name)
  const mode = WebhookCreateStore.useScopedStore((state) => state.mode)
  const chatId = WebhookCreateStore.useScopedStore((state) => state.chatId)
  const projectId = WebhookCreateStore.useScopedStore((state) => state.projectId)
  const modelValue = WebhookCreateStore.useScopedStore((state) => state.modelValue)
  const template = WebhookCreateStore.useScopedStore((state) => state.template)
  const setName = WebhookCreateStore.useScopedStore((state) => state.setName)
  const setMode = WebhookCreateStore.useScopedStore((state) => state.setMode)
  const setChatId = WebhookCreateStore.useScopedStore((state) => state.setChatId)
  const setProjectId = WebhookCreateStore.useScopedStore((state) => state.setProjectId)
  const setModelValue = WebhookCreateStore.useScopedStore((state) => state.setModelValue)
  const setTemplate = WebhookCreateStore.useScopedStore((state) => state.setTemplate)
  const filter = WebhookCreateStore.useScopedStore((state) => state.filter)
  const threadKeyPath = WebhookCreateStore.useScopedStore((state) => state.threadKeyPath)
  const senderPath = WebhookCreateStore.useScopedStore((state) => state.senderPath)
  const replyHint = WebhookCreateStore.useScopedStore((state) => state.replyHint)
  const setFilter = WebhookCreateStore.useScopedStore((state) => state.setFilter)
  const setThreadKeyPath = WebhookCreateStore.useScopedStore((state) => state.setThreadKeyPath)
  const setSenderPath = WebhookCreateStore.useScopedStore((state) => state.setSenderPath)
  const setReplyHint = WebhookCreateStore.useScopedStore((state) => state.setReplyHint)
  const targets = useMemo(() => listWebhookTargets(sidebarData), [sidebarData])
  const modelOptions = useMemo(() => listWebhookModelOptions(catalog), [catalog])
  const startsTurn = mode !== "notify"

  const input = useMemo<WebhookInput>(() => {
    const choice = startsTurn ? decodeWebhookModel(modelValue) : null
    return {
      name,
      mode,
      template,
      ...(mode === "spawn" ? { projectId } : { chatId }),
      ...(choice ? { provider: choice.provider, model: choice.model } : {}),
      ...(filter.trim() ? { filter } : {}),
      ...(threadKeyPath.trim() ? { threadKeyPath: threadKeyPath.trim() } : {}),
      ...(senderPath.trim() ? { senderPath: senderPath.trim() } : {}),
      ...(replyHint.trim() ? { replyHint } : {}),
    }
  }, [chatId, filter, mode, modelValue, name, projectId, replyHint, senderPath, startsTurn, template, threadKeyPath])
  const errors = useMemo(
    () => [...validateWebhookInput(input), ...validateWebhookModel(input, catalog)],
    [catalog, input],
  )

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) closeEditor()
  }, [closeEditor])
  const handleCancel = useCallback(() => closeEditor(), [closeEditor])
  const handleNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setName(event.target.value), [setName])
  const handleTemplateChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setTemplate(event.target.value),
    [setTemplate],
  )
  const handleFilterChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setFilter(event.target.value),
    [setFilter],
  )
  const handleThreadKeyPathChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setThreadKeyPath(event.target.value),
    [setThreadKeyPath],
  )
  const handleSenderPathChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setSenderPath(event.target.value),
    [setSenderPath],
  )
  const handleReplyHintChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setReplyHint(event.target.value),
    [setReplyHint],
  )
  const handleSubmit = useCallback(() => {
    if (errors.length > 0) return
    runPendingAction(submitKey, async () => {
      if (editing) {
        const patch: WebhookPatch = {
          name: input.name,
          mode: input.mode,
          template: input.template,
          chatId: input.chatId ?? null,
          projectId: input.projectId ?? null,
          provider: input.provider ?? null,
          model: input.model ?? null,
          filter: input.filter ?? null,
          threadKeyPath: input.threadKeyPath ?? null,
          senderPath: input.senderPath ?? null,
          replyHint: input.replyHint ?? null,
        }
        await sendWebhookCommand(socket, { type: "webhooks.update", id: editing.id, patch })
      } else {
        await onCreate(input)
      }
      closeEditor()
    })
  }, [closeEditor, editing, errors.length, input, onCreate, socket, submitKey])

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogBody className="space-y-4">
          <DialogTitle>{editing ? "Edit webhook" : "New webhook"}</DialogTitle>
          <DialogDescription>An outside system POSTs to the webhook url and Kanna reacts.</DialogDescription>

          <div className="space-y-1.5">
            <label htmlFor="webhook-name" className="text-sm font-medium text-foreground">Name</label>
            <Input id="webhook-name" value={name} onChange={handleNameChange} placeholder="GitHub CI failures" />
          </div>

          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-foreground">Action</span>
            <SegmentedControl value={mode} onValueChange={setMode} options={MODE_OPTIONS} size="sm" />
            <p className="text-xs text-muted-foreground">{webhookModeConsequence(mode)}</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="webhook-target" className="text-sm font-medium text-foreground">
              {mode === "spawn" ? "Project" : "Chat"}
            </label>
            {mode === "spawn" ? (
              <WebhookTargetSelect id="webhook-target" value={projectId} options={targets.projects} placeholder="Choose a project" searchPlaceholder="Search projects..." onValueChange={setProjectId} />
            ) : (
              <WebhookTargetSelect id="webhook-target" value={chatId} options={targets.chats} placeholder="Choose a chat" searchPlaceholder="Search chats..." onValueChange={setChatId} />
            )}
          </div>

          {startsTurn ? (
            <div className="space-y-1.5">
              <label htmlFor="webhook-model" className="text-sm font-medium text-foreground">Model</label>
              <SearchableSelect
                id="webhook-model"
                value={modelValue}
                options={modelOptions}
                placeholder="Choose a model"
                searchPlaceholder="Search models..."
                onValueChange={setModelValue}
              />
              <p className="text-xs text-muted-foreground">The model the turn started by this webhook runs with.</p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="webhook-template" className="text-sm font-medium text-foreground">Instruction template</label>
            <Textarea id="webhook-template" rows={4} value={template} onChange={handleTemplateChange} />
            <p className="text-xs text-muted-foreground">
              Insert fields from the JSON body with <code className="font-mono">{"{{repo.name}}"}</code>. The body is
              appended to the prompt as untrusted data.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="webhook-filter" className="text-sm font-medium text-foreground">Filter (optional)</label>
            <Textarea
              id="webhook-filter"
              className="font-mono"
              rows={5}
              value={filter}
              onChange={handleFilterChange}
              placeholder={FILTER_PLACEHOLDER}
            />
            <p className="text-xs text-muted-foreground">
              YAML with <code className="font-mono">on</code> (event name from{" "}
              <code className="font-mono">X-GitHub-Event</code>, optional <code className="font-mono">types</code> matched
              against <code className="font-mono">body.action</code>) and <code className="font-mono">if</code> (a CEL
              condition over <code className="font-mono">body</code>, <code className="font-mono">event</code> and{" "}
              <code className="font-mono">headers</code>). Deliveries that do not match are acknowledged and ignored.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="webhook-thread-key" className="text-sm font-medium text-foreground">Thread key path</label>
              <Input id="webhook-thread-key" className="font-mono" value={threadKeyPath} onChange={handleThreadKeyPathChange} />
              <p className="text-xs text-muted-foreground">Deliveries with the same value share one Inbox thread, and in spawn mode one chat.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="webhook-sender" className="text-sm font-medium text-foreground">Sender path</label>
              <Input id="webhook-sender" className="font-mono" value={senderPath} onChange={handleSenderPathChange} />
              <p className="text-xs text-muted-foreground">Shown as the sender of the thread.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="webhook-reply-hint" className="text-sm font-medium text-foreground">Reply hint</label>
            <Textarea id="webhook-reply-hint" rows={3} value={replyHint} onChange={handleReplyHintChange} />
            <p className="text-xs text-muted-foreground">
              Tells the agent how to send a reply through the server's tools when you answer from the Inbox.
            </p>
          </div>

          {errors.length > 0 && name.length > 0 ? <p className="text-xs text-destructive">{errors[0]}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleCancel}>Cancel</Button>
          <Button size="sm" onClick={handleSubmit} disabled={errors.length > 0} pending={pending}>{editing ? "Save" : "Create"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WebhookCreateDialog(props: Props) {
  const editor = useWebhooksStore((state) => state.editor)
  const hooks = useWebhooksStore((state) => state.hooks)
  if (!editor) return null
  const editing = editor.mode === "edit" ? hooks.find((hook) => hook.id === editor.hookId) : undefined
  if (editor.mode === "edit" && !editing) return null
  return (
    <WebhookCreateStore.Provider init={editing}>
      <WebhookEditorForm {...props} editing={editing} />
    </WebhookCreateStore.Provider>
  )
}
