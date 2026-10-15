import { useCallback, useMemo, type ChangeEvent } from "react"
import type { SidebarData } from "../../shared/types"
import type { WebhookInput, WebhookMode } from "../../shared/webhooks/types"
import { validateWebhookInput } from "../../shared/webhooks/validate"
import { Button } from "../components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { SegmentedControl, type SegmentedOption } from "../components/ui/segmented-control"
import { Textarea } from "../components/ui/textarea"
import { webhookModeConsequence, webhookModeLabel } from "../lib/webhookPresentation"
import { listWebhookTargets } from "../lib/webhookTargets"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useWebhooksStore } from "../stores/webhooksStore"
import { WebhookCreateStore } from "./WebhookCreateDialog.store"
import { WebhookTargetSelect } from "./WebhookTargetSelect"

interface Props {
  sidebarData: SidebarData
  onCreate: (input: WebhookInput) => Promise<void>
}

const CREATE_KEY = pendingActionKey("webhooks.create")

const MODE_OPTIONS: SegmentedOption<WebhookMode>[] = (["notify", "inline", "spawn"] as const).map((mode) => ({
  value: mode,
  label: webhookModeLabel(mode),
}))

function CreateForm({ sidebarData, onCreate }: Props) {
  const pending = usePendingAction(CREATE_KEY)
  const setOpen = useWebhooksStore((state) => state.setCreateOpen)
  const name = WebhookCreateStore.useScopedStore((state) => state.name)
  const mode = WebhookCreateStore.useScopedStore((state) => state.mode)
  const chatId = WebhookCreateStore.useScopedStore((state) => state.chatId)
  const projectId = WebhookCreateStore.useScopedStore((state) => state.projectId)
  const template = WebhookCreateStore.useScopedStore((state) => state.template)
  const setName = WebhookCreateStore.useScopedStore((state) => state.setName)
  const setMode = WebhookCreateStore.useScopedStore((state) => state.setMode)
  const setChatId = WebhookCreateStore.useScopedStore((state) => state.setChatId)
  const setProjectId = WebhookCreateStore.useScopedStore((state) => state.setProjectId)
  const setTemplate = WebhookCreateStore.useScopedStore((state) => state.setTemplate)
  const targets = useMemo(() => listWebhookTargets(sidebarData), [sidebarData])

  const input = useMemo<WebhookInput>(
    () => ({ name, mode, template, ...(mode === "spawn" ? { projectId } : { chatId }) }),
    [chatId, mode, name, projectId, template],
  )
  const errors = useMemo(() => validateWebhookInput(input), [input])

  const handleOpenChange = useCallback((open: boolean) => setOpen(open), [setOpen])
  const handleCancel = useCallback(() => setOpen(false), [setOpen])
  const handleNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => setName(event.target.value), [setName])
  const handleTemplateChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setTemplate(event.target.value),
    [setTemplate],
  )
  const handleCreate = useCallback(() => {
    if (errors.length > 0) return
    runPendingAction(CREATE_KEY, async () => {
      await onCreate(input)
      setOpen(false)
    })
  }, [errors.length, input, onCreate, setOpen])

  return (
    <Dialog open onOpenChange={handleOpenChange}>
      <DialogContent size="lg">
        <DialogBody className="space-y-4">
          <DialogTitle>New webhook</DialogTitle>
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
              <WebhookTargetSelect id="webhook-target" value={projectId} options={targets.projects} placeholder="Choose a project" onValueChange={setProjectId} />
            ) : (
              <WebhookTargetSelect id="webhook-target" value={chatId} options={targets.chats} placeholder="Choose a chat" onValueChange={setChatId} />
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="webhook-template" className="text-sm font-medium text-foreground">Instruction template</label>
            <Textarea id="webhook-template" rows={4} value={template} onChange={handleTemplateChange} />
            <p className="text-xs text-muted-foreground">
              Insert fields from the JSON body with <code className="font-mono">{"{{repo.name}}"}</code>. The body is
              appended to the prompt as untrusted data.
            </p>
          </div>

          {errors.length > 0 && name.length > 0 ? <p className="text-xs text-destructive">{errors[0]}</p> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleCancel}>Cancel</Button>
          <Button size="sm" onClick={handleCreate} disabled={errors.length > 0} pending={pending}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function WebhookCreateDialog(props: Props) {
  const open = useWebhooksStore((state) => state.createOpen)
  if (!open) return null
  return (
    <WebhookCreateStore.Provider init={undefined}>
      <CreateForm {...props} />
    </WebhookCreateStore.Provider>
  )
}
