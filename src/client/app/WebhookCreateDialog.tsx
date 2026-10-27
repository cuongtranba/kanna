import { useCallback, useMemo, type ChangeEvent } from "react"
import type { InboundHandling } from "../../shared/inbound/handler"
import type { SidebarData } from "../../shared/types"
import type { WebhookInput, WebhookKind, WebhookMode, WebhookSummary } from "../../shared/webhooks/types"
import { Button } from "../components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { SegmentedControl, type SegmentedOption } from "../components/ui/segmented-control"
import { Textarea } from "../components/ui/textarea"
import {
  buildWebhookInput,
  buildWebhookPatch,
  effectiveWebhookMode,
  validateWebhookDraft,
  webhookDraftStartsTurn,
} from "../lib/webhookDraft"
import {
  webhookHandlingConsequence,
  webhookHandlingLabel,
} from "../lib/webhookPresentation"
import { listInboundModelOptions, listInboundTargets } from "../lib/webhookTargets"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useWebhooksStore } from "../stores/webhooksStore"
import { useOptionalKannaSocket } from "./KannaSocketProvider"
import { useProviderCatalog } from "./useProviderCatalog"
import { sendCommandWithFeedback } from "../lib/commandFeedback"
import { WebhookCreateStore } from "./WebhookCreateDialog.store"
import { InboundHandlerFields } from "./InboundHandlerFields"
import { WebhookGenericFields } from "./WebhookGenericFields"
import { WebhookSlackFields } from "./WebhookSlackFields"

interface Props {
  sidebarData: SidebarData
  origin: string
  onCreate: (input: WebhookInput) => Promise<void>
}

interface FormProps extends Props {
  editing: WebhookSummary | undefined
}

const CREATE_KEY = pendingActionKey("webhooks.create")

const KIND_OPTIONS: SegmentedOption<WebhookKind>[] = [
  { value: "generic", label: "Generic" },
  { value: "slack", label: "Slack" },
]

const SLACK_DESCRIPTION = "Mention @Kanna in a Slack channel to start or continue a chat. Kanna replies in the thread."
const GENERIC_DESCRIPTION = "An outside system POSTs to the webhook url and Kanna reacts."

const HANDLING_OPTIONS: SegmentedOption<InboundHandling>[] = (["triage", "task"] as const).map((handling) => ({
  value: handling,
  label: webhookHandlingLabel(handling),
}))

function WebhookEditorForm({ sidebarData, origin, onCreate, editing }: FormProps) {
  const socket = useOptionalKannaSocket()
  const catalog = useProviderCatalog()
  const submitKey = editing ? pendingActionKey("webhooks.update", editing.id) : CREATE_KEY
  const pending = usePendingAction(submitKey)
  const closeEditor = useWebhooksStore((state) => state.closeEditor)
  const draft = WebhookCreateStore.useScopedStore((state) => state.draft)
  const patchDraft = WebhookCreateStore.useScopedStore((state) => state.patchDraft)
  const setKind = WebhookCreateStore.useScopedStore((state) => state.setKind)
  const targets = useMemo(() => listInboundTargets(sidebarData), [sidebarData])
  const modelOptions = useMemo(() => listInboundModelOptions(catalog), [catalog])
  const isSlack = draft.kind === "slack"
  const mode = effectiveWebhookMode(draft)
  const startsTurn = webhookDraftStartsTurn(draft)

  const input = useMemo(() => buildWebhookInput(draft), [draft])
  const errors = useMemo(() => validateWebhookDraft(input, catalog, editing !== undefined), [catalog, editing, input])

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) closeEditor()
  }, [closeEditor])
  const handleCancel = useCallback(() => closeEditor(), [closeEditor])
  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => patchDraft({ name: event.target.value }),
    [patchDraft],
  )
  const handleTemplateChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => patchDraft({ template: event.target.value }),
    [patchDraft],
  )
  const handleModeChange = useCallback((value: WebhookMode) => patchDraft({ mode: value }), [patchDraft])
  const handleHandlingChange = useCallback((value: InboundHandling) => patchDraft({ handling: value }), [patchDraft])
  const handleChatChange = useCallback((chatId: string) => patchDraft({ chatId }), [patchDraft])
  const handleProjectChange = useCallback((projectId: string) => patchDraft({ projectId }), [patchDraft])
  const handleModelChange = useCallback((modelValue: string) => patchDraft({ modelValue }), [patchDraft])
  const handleSubmit = useCallback(() => {
    if (errors.length > 0) return
    runPendingAction(submitKey, async () => {
      if (editing) {
        await sendCommandWithFeedback(socket, { type: "webhooks.update", id: editing.id, patch: buildWebhookPatch(input) })
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
          <DialogDescription>{isSlack ? SLACK_DESCRIPTION : GENERIC_DESCRIPTION}</DialogDescription>

          {editing ? null : (
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-foreground">Kind</span>
              <SegmentedControl value={draft.kind} onValueChange={setKind} options={KIND_OPTIONS} size="sm" />
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="webhook-name" className="text-sm font-medium text-foreground">Name</label>
            <Input
              id="webhook-name"
              value={draft.name}
              onChange={handleNameChange}
              placeholder={isSlack ? "Slack" : "GitHub CI failures"}
            />
          </div>

          <InboundHandlerFields
            idPrefix="webhook"
            mode={mode}
            chatId={draft.chatId}
            projectId={draft.projectId}
            modelValue={draft.modelValue}
            targets={targets}
            modelOptions={modelOptions}
            modelHint="The model the turn started by this webhook runs with."
            showModeControl={!isSlack}
            startsTurn={startsTurn}
            targetNote={isSlack ? <p className="text-xs text-muted-foreground">Each Slack thread gets its own chat in this project.</p> : null}
            beforeModel={
              <>
                {isSlack ? <WebhookSlackFields editing={editing} origin={origin} /> : null}
                {startsTurn && !isSlack ? (
                  <div className="space-y-1.5">
                    <span className="block text-sm font-medium text-foreground">Handling</span>
                    <SegmentedControl value={draft.handling} onValueChange={handleHandlingChange} options={HANDLING_OPTIONS} size="sm" />
                    <p className="text-xs text-muted-foreground">{webhookHandlingConsequence(draft.handling)}</p>
                  </div>
                ) : null}
              </>
            }
            onModeChange={handleModeChange}
            onChatChange={handleChatChange}
            onProjectChange={handleProjectChange}
            onModelChange={handleModelChange}
          />

          <div className="space-y-1.5">
            <label htmlFor="webhook-template" className="text-sm font-medium text-foreground">
              {isSlack ? "Standing instructions (optional)" : "Instruction template"}
            </label>
            <Textarea id="webhook-template" rows={4} value={draft.template} onChange={handleTemplateChange} />
            {isSlack ? (
              <p className="text-xs text-muted-foreground">Added to every Slack request, before the thread context.</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Insert fields from the JSON body with <code className="font-mono">{"{{repo.name}}"}</code>. The body is
                appended to the prompt as untrusted data.
              </p>
            )}
          </div>

          {isSlack ? null : <WebhookGenericFields />}

          {errors.length > 0 && draft.name.length > 0 ? <p className="text-xs text-destructive">{errors[0]}</p> : null}
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
