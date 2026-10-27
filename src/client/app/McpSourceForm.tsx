import { useCallback, useMemo, type ChangeEvent, type ReactNode } from "react"
import type { InboundHandlerMode } from "../../shared/inbound/handler"
import type { McpSource, McpSourceMode } from "../../shared/mcp-sources/types"
import type { McpServerConfig, SidebarData } from "../../shared/types"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { SearchableSelect, type SearchableOption } from "../components/ui/searchable-select"
import { SegmentedControl, type SegmentedOption } from "../components/ui/segmented-control"
import { Textarea } from "../components/ui/textarea"
import { mcpSourceInputFromDraft, mcpSourcePatchFromInput, type McpSourceDraft } from "../lib/mcpSourceDraft"
import { surfaceErrorIn } from "../lib/commandFeedback"
import { mcpSourceModeConsequence, mcpSourceModeLabel } from "../lib/mcpSourcePresentation"
import { webhookModeConsequence, webhookModeLabel } from "../lib/webhookPresentation"
import { listWebhookModelOptions, listWebhookTargets } from "../lib/webhookTargets"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useMcpSourcesSectionStore } from "../stores/mcpSourcesSectionStore"
import { WebhookTargetSelect } from "./WebhookTargetSelect"
import { useProviderCatalog } from "./useProviderCatalog"
import type { McpSourcesSectionHandlers } from "./McpSourcesSection"

const MODE_OPTIONS: SegmentedOption<McpSourceMode>[] = (["subscribe", "poll"] as const).map((mode) => ({
  value: mode,
  label: mcpSourceModeLabel(mode),
}))

const HANDLER_OPTIONS: SegmentedOption<InboundHandlerMode>[] = (["notify", "inline", "spawn"] as const).map((mode) => ({
  value: mode,
  label: webhookModeLabel(mode),
}))

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

function serverOptions(servers: readonly McpServerConfig[], selectedId: string): SearchableOption[] {
  const usable = servers.filter((server) => server.transport !== "ws" && (server.enabled || server.id === selectedId))
  const network = usable.filter((server) => server.transport !== "stdio")
  const local = usable.filter((server) => server.transport === "stdio")
  return [...network, ...local].map((server) => ({ value: server.id, label: server.name, hint: server.transport }))
}

function SubscribeFields({ draft, onChange }: { draft: McpSourceDraft; onChange: (patch: Partial<McpSourceDraft>) => void }) {
  return (
    <Field id="mcp-source-uris" label="Resource URIs" hint="One URI per line. Kanna subscribes to each and reads it whenever the server says it changed.">
      <Textarea
        id="mcp-source-uris"
        rows={3}
        className="font-mono"
        value={draft.resourceUris}
        onChange={(event) => onChange({ resourceUris: event.target.value })}
      />
    </Field>
  )
}

function PollFields({ draft, onChange }: { draft: McpSourceDraft; onChange: (patch: Partial<McpSourceDraft>) => void }) {
  return (
    <div className="space-y-4">
      <Field id="mcp-source-tool" label="List tool" hint="The tool Kanna calls on every poll.">
        <Input id="mcp-source-tool" className="font-mono" value={draft.tool} onChange={(event) => onChange({ tool: event.target.value })} />
      </Field>
      <Field id="mcp-source-args" label="Arguments" hint="A JSON object sent with every call. The cursor is added under the cursor argument.">
        <Textarea id="mcp-source-args" rows={3} className="font-mono" value={draft.argsText} onChange={(event) => onChange({ argsText: event.target.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="mcp-source-cursor-arg" label="Cursor argument">
          <Input id="mcp-source-cursor-arg" className="font-mono" value={draft.cursorArg} onChange={(event) => onChange({ cursorArg: event.target.value })} />
        </Field>
        <Field id="mcp-source-cursor-path" label="Cursor path" hint="Where the next cursor sits in the result.">
          <Input id="mcp-source-cursor-path" className="font-mono" value={draft.cursorPath} onChange={(event) => onChange({ cursorPath: event.target.value })} />
        </Field>
        <Field id="mcp-source-items-path" label="Items path" hint="Where the array of messages sits in the result.">
          <Input id="mcp-source-items-path" className="font-mono" value={draft.itemsPath} onChange={(event) => onChange({ itemsPath: event.target.value })} />
        </Field>
        <Field id="mcp-source-item-key" label="Item key path" hint="A field that is unique per message. Leave empty to hash the whole item.">
          <Input id="mcp-source-item-key" className="font-mono" value={draft.itemKeyPath} onChange={(event) => onChange({ itemKeyPath: event.target.value })} />
        </Field>
        <Field id="mcp-source-interval" label="Interval (seconds)" hint="Between 5 and 3600.">
          <Input id="mcp-source-interval" inputMode="numeric" className="tabular-nums" value={draft.intervalSeconds} onChange={(event) => onChange({ intervalSeconds: event.target.value })} />
        </Field>
      </div>
    </div>
  )
}

interface FormProps {
  editing: McpSource | null
  servers: readonly McpServerConfig[]
  sidebarData: SidebarData
  handlers: McpSourcesSectionHandlers
}

export function McpSourceForm({ editing, servers, sidebarData, handlers }: FormProps) {
  const catalog = useProviderCatalog()
  const draft = useMcpSourcesSectionStore((state) => state.draft)
  const error = useMcpSourcesSectionStore((state) => state.error)
  const patchDraft = useMcpSourcesSectionStore((state) => state.patchDraft)
  const applyPreset = useMcpSourcesSectionStore((state) => state.applyZaloPreset)
  const closeEditor = useMcpSourcesSectionStore((state) => state.closeEditor)
  const setError = useMcpSourcesSectionStore((state) => state.setError)
  const saveKey = pendingActionKey("mcpSources.save", editing?.id ?? "new")
  const saving = usePendingAction(saveKey)
  const targets = useMemo(() => listWebhookTargets(sidebarData), [sidebarData])
  const modelOptions = useMemo(() => listWebhookModelOptions(catalog), [catalog])
  const options = useMemo(() => serverOptions(servers, draft.serverId), [servers, draft.serverId])
  const result = useMemo(() => mcpSourceInputFromDraft(draft), [draft])
  const startsTurn = draft.handlerMode !== "notify"

  const handleNameChange = useCallback((event: ChangeEvent<HTMLInputElement>) => patchDraft({ name: event.target.value }), [patchDraft])
  const handleSave = useCallback(() => {
    if (!result.ok) return
    runPendingAction(saveKey, () => surfaceErrorIn(setError, async () => {
      if (editing) await handlers.onUpdate(editing.id, mcpSourcePatchFromInput(result.input))
      else await handlers.onCreate(result.input)
      closeEditor()
    }))
  }, [closeEditor, editing, handlers, result, saveKey, setError])

  return (
    <div className="flex flex-col gap-5 px-6 py-6">
      <div className="flex items-start justify-between gap-4">
        <h2 className="text-base font-medium">{editing ? "Edit MCP source" : "Add MCP source"}</h2>
        <Button variant="secondary" size="sm" onClick={applyPreset}>Zalo preset</Button>
      </div>

      <Field id="mcp-source-name" label="Name">
        <Input id="mcp-source-name" value={draft.name} onChange={handleNameChange} placeholder="Zalo" autoFocus />
      </Field>

      <Field
        id="mcp-source-server"
        label="MCP server"
        hint="A stdio server started here is a separate process from the one your chats use — prefer http or sse."
      >
        <SearchableSelect
          id="mcp-source-server"
          value={draft.serverId}
          options={options}
          placeholder="Choose an MCP server"
          searchPlaceholder="Search servers..."
          emptyMessage="Add an MCP server first"
          onValueChange={(serverId) => patchDraft({ serverId })}
        />
      </Field>

      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-foreground">How messages arrive</span>
        <SegmentedControl value={draft.mode} onValueChange={(mode) => patchDraft({ mode })} options={MODE_OPTIONS} size="sm" />
        <p className="text-xs text-muted-foreground">{mcpSourceModeConsequence(draft.mode)}</p>
      </div>

      {draft.mode === "subscribe" ? <SubscribeFields draft={draft} onChange={patchDraft} /> : <PollFields draft={draft} onChange={patchDraft} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="mcp-source-thread-key" label="Thread key path" hint="Messages with the same value share one Inbox thread.">
          <Input id="mcp-source-thread-key" className="font-mono" value={draft.threadKeyPath} onChange={(event) => patchDraft({ threadKeyPath: event.target.value })} />
        </Field>
        <Field id="mcp-source-sender" label="Sender path" hint="Shown as the sender of the thread.">
          <Input id="mcp-source-sender" className="font-mono" value={draft.senderPath} onChange={(event) => patchDraft({ senderPath: event.target.value })} />
        </Field>
      </div>

      <div className="space-y-1.5">
        <span className="block text-sm font-medium text-foreground">Action</span>
        <SegmentedControl value={draft.handlerMode} onValueChange={(handlerMode) => patchDraft({ handlerMode })} options={HANDLER_OPTIONS} size="sm" />
        <p className="text-xs text-muted-foreground">{webhookModeConsequence(draft.handlerMode)}</p>
      </div>

      <Field id="mcp-source-target" label={draft.handlerMode === "spawn" ? "Project" : "Chat"}>
        {draft.handlerMode === "spawn" ? (
          <WebhookTargetSelect id="mcp-source-target" value={draft.projectId} options={targets.projects} placeholder="Choose a project" searchPlaceholder="Search projects..." onValueChange={(projectId) => patchDraft({ projectId })} />
        ) : (
          <WebhookTargetSelect id="mcp-source-target" value={draft.chatId} options={targets.chats} placeholder="Choose a chat" searchPlaceholder="Search chats..." onValueChange={(chatId) => patchDraft({ chatId })} />
        )}
      </Field>

      {startsTurn ? (
        <Field id="mcp-source-model" label="Model" hint="The model the turn started by each message runs with.">
          <SearchableSelect
            id="mcp-source-model"
            value={draft.modelValue}
            options={modelOptions}
            placeholder="Choose a model"
            searchPlaceholder="Search models..."
            onValueChange={(modelValue) => patchDraft({ modelValue })}
          />
        </Field>
      ) : null}

      <Field id="mcp-source-template" label="Instruction template" hint={<>Insert fields from the message with <code className="font-mono">{"{{senderName}}"}</code>. The message is appended as untrusted data.</>}>
        <Textarea id="mcp-source-template" rows={4} value={draft.template} onChange={(event) => patchDraft({ template: event.target.value })} />
      </Field>

      <Field id="mcp-source-reply-hint" label="Reply hint" hint="Tells the agent how to send a reply through the server's tools when you answer from the Inbox.">
        <Textarea id="mcp-source-reply-hint" rows={3} value={draft.replyHint} onChange={(event) => patchDraft({ replyHint: event.target.value })} />
      </Field>

      <label className="flex cursor-pointer items-center gap-3 text-sm">
        <input
          type="checkbox"
          checked={draft.pushEnabled}
          onChange={(event) => patchDraft({ pushEnabled: event.target.checked })}
          className="h-4 w-4 shrink-0 rounded border-border accent-foreground"
        />
        Send a push notification for new messages
      </label>

      {!result.ok && draft.name.length > 0 ? <p className="text-xs text-destructive-text">{result.errors[0]}</p> : null}
      {error ? <p className="text-xs text-destructive-text">{error}</p> : null}

      <div className="flex items-center gap-2">
        <Button onClick={handleSave} pending={saving} disabled={!result.ok}>{editing ? "Save changes" : "Add source"}</Button>
        <Button variant="ghost" onClick={closeEditor} disabled={saving}>Cancel</Button>
      </div>
    </div>
  )
}
