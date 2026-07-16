import { useCallback, useEffect, useMemo, useRef } from "react"
import { Plug, Plus, Trash2, RefreshCw, Pencil, ExternalLink, Copy, KeyRound } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Textarea } from "../components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select"
import { cn } from "../lib/utils"
import { useAppSettingsStore, selectCustomMcpServers } from "../stores/appSettingsStore"
import {
  useMcpServersSectionStore,
  type EditingState,
} from "../stores/mcpServersSectionStore"
import type {
  AppSettingsPatch,
  McpOAuthState,
  McpServerConfig,
  McpServerInput,
  McpServerPatch,
  McpServerTestResult,
  McpServerTransport,
} from "../../shared/types"
import type { KannaState } from "./useKannaState"
import type { DomPort } from "../ports/domPort"
import type { ClipboardPort } from "../ports/clipboardPort"
import { domAdapter } from "../adapters/dom.adapter"
import { clipboardAdapter } from "../adapters/clipboard.adapter"

const MCP_TRANSPORT_SET = new Set<string>(["stdio", "http", "sse", "ws"])
function isMcpServerTransport(v: string): v is McpServerTransport {
  return MCP_TRANSPORT_SET.has(v)
}

interface OAuthStartResult {
  ok: boolean
  authorizationUrl?: string
  alreadyAuthenticated?: boolean
  error?: string
}

interface McpServersSectionHandlers {
  onCreate: (input: McpServerInput) => Promise<void>
  onUpdate: (id: string, patch: McpServerPatch) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>
  onTest: (id: string) => Promise<void>
  onStartMcpOAuth: (id: string) => Promise<OAuthStartResult>
  onCompleteMcpOAuth: (id: string, callbackUrl: string) => Promise<{ ok: boolean; error?: string }>
}

interface McpServersSectionProps {
  servers: readonly McpServerConfig[]
  editing: EditingState
  onSelect: (id: string) => void
  onStartCreate: () => void
  onCancelEditing: () => void
  handlers: McpServersSectionHandlers
}

export function McpServersSection(props: McpServersSectionProps) {
  if (props.editing.kind !== "list") {
    return (
      <McpServerEditor
        initial={
          props.editing.kind === "edit"
            ? (props.servers.find((s) => props.editing.kind === "edit" && s.id === props.editing.id) ?? null)
            : null
        }
        existingNames={props.servers.map((s) => ({ id: s.id, name: s.name }))}
        onCancel={props.onCancelEditing}
        handlers={props.handlers}
      />
    )
  }

  if (props.servers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <Plug className="mb-4 h-10 w-10 text-muted-foreground" aria-hidden />
        <h2 className="text-lg font-medium">No custom MCP servers</h2>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          Install MCP servers to extend the model&apos;s tool surface. Supports stdio, http, sse,
          and ws transports.
        </p>
        <Button className="mt-6" onClick={props.onStartCreate}>
          <Plus className="mr-1 h-4 w-4" />
          Add server
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 px-6 py-6">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">Custom MCP servers</h2>
        <Button size="sm" onClick={props.onStartCreate}>
          <Plus className="mr-1 h-4 w-4" />
          Add server
        </Button>
      </div>
      <ul className="flex flex-col divide-y rounded-md border">
        {props.servers.map((s) => (
          <McpRow
            key={s.id}
            server={s}
            handlers={props.handlers}
            onEdit={() => props.onSelect(s.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function McpRow({
  server,
  handlers,
  onEdit,
  dom = domAdapter,
}: {
  server: McpServerConfig
  handlers: McpServersSectionHandlers
  onEdit: () => void
  dom?: DomPort
}) {
  const testing = useMcpServersSectionStore((s) => s.testingServerIds.has(server.id))
  const setServerTesting = useMcpServersSectionStore((s) => s.setServerTesting)

  const onTest = useCallback(async () => {
    setServerTesting(server.id, true)
    try {
      await handlers.onTest(server.id)
    } finally {
      setServerTesting(server.id, false)
    }
  }, [handlers, server.id, setServerTesting])

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex flex-col">
        <span className="font-medium">{server.name}</span>
        <span className="text-xs text-muted-foreground">
          <TransportBadge transport={server.transport} />
          <span className="ml-2">
            {server.transport === "stdio" ? server.command : server.url}
          </span>
        </span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <TestPill result={server.lastTest} pending={testing} />
        {server.transport !== "stdio" && <OAuthPill oauth={server.oauth} />}
        <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={server.enabled}
            onChange={(e) => {
              void handlers.onSetEnabled(server.id, e.target.checked)
            }}
            aria-label="Enabled"
          />
          <span>On</span>
        </label>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void onTest()
          }}
          title="Test connection"
        >
          <RefreshCw className={cn("h-4 w-4", testing && "animate-spin")} />
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit} title="Edit">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (dom.confirmDialog(`Delete MCP server "${server.name}"?`)) {
              void handlers.onDelete(server.id)
            }
          }}
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  )
}

function TransportBadge({ transport }: { transport: McpServerTransport }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{transport}</span>
  )
}

function TestPill({ result, pending }: { result: McpServerTestResult; pending: boolean }) {
  if (pending || result.status === "pending") {
    return <span className="text-xs text-muted-foreground">Testing…</span>
  }
  switch (result.status) {
    case "ok":
      return (
        <span className="text-xs text-green-600">
          OK · {result.toolCount} tools
        </span>
      )
    case "error":
      return (
        <span className="text-xs text-red-600" title={result.message}>
          Failed
        </span>
      )
    case "untested":
    default:
      return <span className="text-xs text-muted-foreground">Untested</span>
  }
}

function OAuthPill({ oauth }: { oauth: McpOAuthState | undefined }) {
  if (!oauth?.enabled) return null
  switch (oauth.status) {
    case "authenticated":
      return <span className="text-xs text-green-600">OAuth ✓</span>
    case "error":
      return (
        <span className="text-xs text-red-600" title={oauth.errorMessage}>
          OAuth error
        </span>
      )
    default:
      return <span className="text-xs text-muted-foreground">OAuth: unauth</span>
  }
}

// ── Editor form ───────────────────────────────────────────────────────────

function McpServerEditor({
  initial,
  existingNames,
  onCancel,
  handlers,
  clipboard = clipboardAdapter,
}: {
  initial: McpServerConfig | null
  existingNames: Array<{ id: string; name: string }>
  onCancel: () => void
  handlers: McpServersSectionHandlers
  clipboard?: ClipboardPort
}) {
  const editorForm = useMcpServersSectionStore((s) => s.editorForm)
  const resetEditorForm = useMcpServersSectionStore((s) => s.resetEditorForm)
  const setEditorName = useMcpServersSectionStore((s) => s.setEditorName)
  const setEditorTransport = useMcpServersSectionStore((s) => s.setEditorTransport)
  const setEditorCommand = useMcpServersSectionStore((s) => s.setEditorCommand)
  const setEditorArgsText = useMcpServersSectionStore((s) => s.setEditorArgsText)
  const setEditorEnvText = useMcpServersSectionStore((s) => s.setEditorEnvText)
  const setEditorCwd = useMcpServersSectionStore((s) => s.setEditorCwd)
  const setEditorUrl = useMcpServersSectionStore((s) => s.setEditorUrl)
  const setEditorHeadersText = useMcpServersSectionStore((s) => s.setEditorHeadersText)
  const setEditorError = useMcpServersSectionStore((s) => s.setEditorError)
  const setEditorSubmitting = useMcpServersSectionStore((s) => s.setEditorSubmitting)
  const setEditorOauthEnabled = useMcpServersSectionStore((s) => s.setEditorOauthEnabled)
  const setEditorAuthFlowUrl = useMcpServersSectionStore((s) => s.setEditorAuthFlowUrl)
  const setEditorCallbackInput = useMcpServersSectionStore((s) => s.setEditorCallbackInput)
  const setEditorOauthError = useMcpServersSectionStore((s) => s.setEditorOauthError)
  const setEditorAuthenticating = useMcpServersSectionStore((s) => s.setEditorAuthenticating)
  const setEditorCompleting = useMcpServersSectionStore((s) => s.setEditorCompleting)

  const {
    name,
    transport,
    command,
    argsText,
    envText,
    cwd,
    url,
    headersText,
    error,
    submitting,
    oauthEnabled,
    authFlowUrl,
    callbackInput,
    oauthError,
    authenticating,
    completing,
  } = editorForm

  // Reset form state from `initial` on mount.
  // McpServerEditor always mounts fresh (it is only rendered when editing.kind !== "list"
  // and unmounts when the user returns to the list), so a mount-only effect is correct.
  const initialRef = useRef(initial)
  useEffect(() => {
    resetEditorForm(initialRef.current)
  }, [resetEditorForm])

  const currentOauth = initial !== null && initial.transport !== "stdio" ? initial.oauth : undefined

  const toggleOAuth = useCallback(
    async (enabled: boolean) => {
      setEditorOauthEnabled(enabled)
      if (!enabled) {
        setEditorAuthFlowUrl(null)
        setEditorCallbackInput("")
        setEditorOauthError(null)
      }
      if (initial) {
        await handlers.onUpdate(initial.id, {
          oauth: { ...(currentOauth ?? { status: "unauthenticated" as const }), enabled },
        })
      }
    },
    [
      initial,
      currentOauth,
      handlers,
      setEditorOauthEnabled,
      setEditorAuthFlowUrl,
      setEditorCallbackInput,
      setEditorOauthError,
    ],
  )

  const startAuth = useCallback(async () => {
    if (!initial) return
    setEditorAuthenticating(true)
    setEditorOauthError(null)
    try {
      const result = await handlers.onStartMcpOAuth(initial.id)
      if (result.ok && result.authorizationUrl) {
        setEditorAuthFlowUrl(result.authorizationUrl)
      } else if (result.ok && result.alreadyAuthenticated) {
        setEditorAuthFlowUrl(null)
      } else {
        setEditorOauthError(result.error ?? "Failed to start OAuth flow")
      }
    } finally {
      setEditorAuthenticating(false)
    }
  }, [
    initial,
    handlers,
    setEditorAuthenticating,
    setEditorOauthError,
    setEditorAuthFlowUrl,
  ])

  const completeAuth = useCallback(async () => {
    if (!initial) return
    setEditorCompleting(true)
    setEditorOauthError(null)
    try {
      const result = await handlers.onCompleteMcpOAuth(initial.id, callbackInput)
      if (result.ok) {
        setEditorAuthFlowUrl(null)
        setEditorCallbackInput("")
      } else {
        setEditorOauthError(result.error ?? "Failed to complete OAuth flow")
      }
    } finally {
      setEditorCompleting(false)
    }
  }, [
    initial,
    callbackInput,
    handlers,
    setEditorCompleting,
    setEditorOauthError,
    setEditorAuthFlowUrl,
    setEditorCallbackInput,
  ])

  const nameError = useMemo(() => {
    if (name.length === 0) return null
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(name)) {
      return "Name must start with a letter and contain only letters, digits, '_' or '-' (max 32 chars)."
    }
    if (name === "kanna") return "'kanna' is reserved."
    const dup = existingNames.find((e) => e.name === name && e.id !== initial?.id)
    if (dup) return "Name already taken."
    return null
  }, [name, existingNames, initial?.id])

  const submit = useCallback(async () => {
    if (nameError) return
    setEditorSubmitting(true)
    setEditorError(null)
    try {
      const args = argsText
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
      const env: Record<string, string> = {}
      for (const line of envText.split("\n")) {
        const idx = line.indexOf("=")
        if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1)
      }
      const headers: Record<string, string> = {}
      for (const line of headersText.split("\n")) {
        const idx = line.indexOf(":")
        if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      }
      if (initial) {
        const patch: McpServerPatch =
          transport === "stdio"
            ? { name, transport, command, args, env, cwd: cwd || undefined }
            : { name, transport, url, headers }
        await handlers.onUpdate(initial.id, patch)
      } else {
        const input: McpServerInput =
          transport === "stdio"
            ? { name, transport: "stdio", command, args, env, cwd: cwd || undefined }
            : { name, transport, url, headers }
        await handlers.onCreate(input)
      }
      onCancel()
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : String(err))
    } finally {
      setEditorSubmitting(false)
    }
  }, [
    argsText,
    command,
    cwd,
    envText,
    handlers,
    headersText,
    initial,
    name,
    nameError,
    onCancel,
    transport,
    url,
    setEditorSubmitting,
    setEditorError,
  ])

  let submitLabel: string
  if (submitting) {
    submitLabel = "Saving…"
  } else if (initial) {
    submitLabel = "Save changes"
  } else {
    submitLabel = "Add server"
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6 max-w-2xl">
      <h2 className="text-base font-medium">
        {initial ? "Edit MCP server" : "Add MCP server"}
      </h2>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Name</span>
        <Input
          value={name}
          onChange={(e) => setEditorName(e.target.value)}
          placeholder="fs"
        />
        {nameError && <p className="text-xs text-red-600">{nameError}</p>}
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Transport</span>
        <Select
          value={transport}
          onValueChange={(v) => { if (isMcpServerTransport(v)) setEditorTransport(v) }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="stdio">stdio (spawn local command)</SelectItem>
            <SelectItem value="http">http (Streamable HTTP)</SelectItem>
            <SelectItem value="sse">sse (Server-Sent Events)</SelectItem>
            <SelectItem value="ws">ws (WebSocket)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {transport === "stdio" ? (
        <>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">Command</span>
            <Input
              value={command}
              onChange={(e) => setEditorCommand(e.target.value)}
              placeholder="/usr/local/bin/mcp-filesystem"
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">
              Args (one per line)
            </span>
            <Textarea
              value={argsText}
              onChange={(e) => setEditorArgsText(e.target.value)}
              rows={3}
              className="font-mono text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">
              Env (KEY=value, one per line)
            </span>
            <Textarea
              value={envText}
              onChange={(e) => setEditorEnvText(e.target.value)}
              rows={3}
              className="font-mono text-sm"
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">
              cwd (optional)
            </span>
            <Input
              value={cwd}
              onChange={(e) => setEditorCwd(e.target.value)}
              placeholder="/optional/working/dir"
            />
          </div>
        </>
      ) : (
        <>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">URL</span>
            <Input
              value={url}
              onChange={(e) => setEditorUrl(e.target.value)}
              placeholder={
                transport === "ws"
                  ? "wss://example.com/mcp"
                  : "https://example.com/mcp"
              }
            />
          </div>
          {transport === "ws" ? (
            <p className="text-xs text-muted-foreground">
              Headers are not supported on the ws transport.
            </p>
          ) : (
            <div className="grid gap-1.5">
              <span className="text-xs font-medium text-foreground">
                Headers (Key: value, one per line)
              </span>
              <Textarea
                value={headersText}
                onChange={(e) => setEditorHeadersText(e.target.value)}
                rows={3}
                className="font-mono text-sm"
                disabled={oauthEnabled}
              />
              {oauthEnabled && (
                <p className="text-xs text-muted-foreground">
                  Authorization header is managed by OAuth when enabled.
                </p>
              )}
            </div>
          )}
          {(transport === "http" || transport === "sse") && (
            <div className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span className="text-xs font-medium">OAuth 2.1</span>
                <label className="ml-auto flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={oauthEnabled}
                    onChange={(e) => { void toggleOAuth(e.target.checked) }}
                    aria-label="Enable OAuth"
                  />
                  <span>Enable</span>
                </label>
              </div>
              {oauthEnabled && !initial && (
                <p className="text-xs text-muted-foreground">
                  Save the server first, then authenticate.
                </p>
              )}
              {oauthEnabled && initial && (
                <>
                  <div className="flex items-center gap-2">
                    <OAuthPill oauth={currentOauth} />
                    {currentOauth?.status === "authenticated" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { void startAuth() }}
                        disabled={authenticating}
                      >
                        Re-authenticate
                      </Button>
                    )}
                  </div>
                  {(currentOauth?.status !== "authenticated" || authFlowUrl) && (
                    !authFlowUrl ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-fit"
                        onClick={() => { void startAuth() }}
                        disabled={authenticating}
                      >
                        {authenticating ? "Starting…" : "Authenticate"}
                      </Button>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1">
                          <a
                            href={authFlowUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-xs text-blue-600 underline"
                          >
                            Open authorization URL
                            <ExternalLink className="h-3 w-3" />
                          </a>
                          <button
                            type="button"
                            onClick={() => { void clipboard.writeText(authFlowUrl) }}
                            className="ml-1 text-muted-foreground hover:text-foreground"
                            title="Copy URL"
                            aria-label="Copy authorization URL"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="grid gap-1">
                          <span className="text-xs text-muted-foreground">
                            After authorizing, paste the callback URL here:
                          </span>
                          <Input
                            value={callbackInput}
                            onChange={(e) => setEditorCallbackInput(e.target.value)}
                            placeholder="http://localhost:…/callback?code=…"
                            className="font-mono text-xs"
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-fit"
                          onClick={() => { void completeAuth() }}
                          disabled={completing || callbackInput.length === 0}
                        >
                          {completing ? "Completing…" : "Complete"}
                        </Button>
                      </div>
                    )
                  )}
                  {oauthError && <p className="text-xs text-red-600">{oauthError}</p>}
                </>
              )}
            </div>
          )}
        </>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          onClick={() => {
            void submit()
          }}
          disabled={submitting || Boolean(nameError) || name.length === 0}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}

// ── Settings page wrapper ─────────────────────────────────────────────────

export function McpServersSettingsBranch(props: {
  state: Pick<KannaState, "handleWriteAppSettings" | "handleTestMcpServer" | "handleStartMcpOAuth" | "handleCompleteMcpOAuth">
}) {
  const servers = useAppSettingsStore(selectCustomMcpServers)
  const editing = useMcpServersSectionStore((s) => s.editing)
  const setEditing = useMcpServersSectionStore((s) => s.setEditing)

  const handlers = useMemo<McpServersSectionHandlers>(
    () => ({
      onCreate: async (input) => {
        const patch: AppSettingsPatch = { customMcpServers: { create: input } }
        await props.state.handleWriteAppSettings(patch)
      },
      onUpdate: async (id, patch) => {
        const settings: AppSettingsPatch = { customMcpServers: { update: { id, patch } } }
        await props.state.handleWriteAppSettings(settings)
      },
      onDelete: async (id) => {
        const patch: AppSettingsPatch = { customMcpServers: { delete: { id } } }
        await props.state.handleWriteAppSettings(patch)
        setEditing({ kind: "list" })
      },
      onSetEnabled: async (id, enabled) => {
        const patch: AppSettingsPatch = { customMcpServers: { setEnabled: { id, enabled } } }
        await props.state.handleWriteAppSettings(patch)
      },
      onTest: async (id) => {
        await props.state.handleTestMcpServer(id)
      },
      onStartMcpOAuth: async (id) => props.state.handleStartMcpOAuth(id),
      onCompleteMcpOAuth: async (id, callbackUrl) => props.state.handleCompleteMcpOAuth(id, callbackUrl),
    }),
    [props.state, setEditing],
  )

  return (
    <McpServersSection
      servers={servers}
      editing={editing}
      onSelect={(id) => setEditing({ kind: "edit", id })}
      onStartCreate={() => setEditing({ kind: "create" })}
      onCancelEditing={() => setEditing({ kind: "list" })}
      handlers={handlers}
    />
  )
}
