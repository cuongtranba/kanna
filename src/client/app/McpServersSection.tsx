import { useCallback, useMemo, useState } from "react"
import { Plug, Plus, Trash2, RefreshCw, Pencil } from "lucide-react"
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
import type {
  AppSettingsPatch,
  McpServerConfig,
  McpServerInput,
  McpServerPatch,
  McpServerTestResult,
  McpServerTransport,
} from "../../shared/types"
import type { KannaState } from "./useKannaState"

interface McpServersSectionHandlers {
  onCreate: (input: McpServerInput) => Promise<void>
  onUpdate: (id: string, patch: McpServerPatch) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onSetEnabled: (id: string, enabled: boolean) => Promise<void>
  onTest: (id: string) => Promise<void>
}

type EditingState =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; id: string }

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
            ? (props.servers.find((s) => s.id === (props.editing as { kind: "edit"; id: string }).id) ?? null)
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
}: {
  server: McpServerConfig
  handlers: McpServersSectionHandlers
  onEdit: () => void
}) {
  const [testing, setTesting] = useState(false)
  const onTest = useCallback(async () => {
    setTesting(true)
    try {
      await handlers.onTest(server.id)
    } finally {
      setTesting(false)
    }
  }, [handlers, server.id])

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
            if (window.confirm(`Delete MCP server "${server.name}"?`)) {
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

// ── Editor form ───────────────────────────────────────────────────────────

function McpServerEditor({
  initial,
  existingNames,
  onCancel,
  handlers,
}: {
  initial: McpServerConfig | null
  existingNames: Array<{ id: string; name: string }>
  onCancel: () => void
  handlers: McpServersSectionHandlers
}) {
  const [name, setName] = useState(initial?.name ?? "")
  const [transport, setTransport] = useState<McpServerTransport>(
    initial?.transport ?? "stdio",
  )
  const [command, setCommand] = useState(
    initial?.transport === "stdio" ? initial.command : "",
  )
  const [argsText, setArgsText] = useState(
    initial?.transport === "stdio" ? initial.args.join("\n") : "",
  )
  const [envText, setEnvText] = useState(
    initial?.transport === "stdio"
      ? Object.entries(initial.env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n")
      : "",
  )
  const [cwd, setCwd] = useState(
    initial?.transport === "stdio" ? (initial.cwd ?? "") : "",
  )
  const [url, setUrl] = useState(
    initial && initial.transport !== "stdio" ? initial.url : "",
  )
  const [headersText, setHeadersText] = useState(
    initial && initial.transport !== "stdio"
      ? Object.entries(initial.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      : "",
  )
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
    setSubmitting(true)
    setError(null)
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
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
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
  ])

  return (
    <div className="flex flex-col gap-4 px-6 py-6 max-w-2xl">
      <h2 className="text-base font-medium">
        {initial ? "Edit MCP server" : "Add MCP server"}
      </h2>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Name</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="fs"
        />
        {nameError && <p className="text-xs text-red-600">{nameError}</p>}
      </div>

      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">Transport</span>
        <Select
          value={transport}
          onValueChange={(v) => setTransport(v as McpServerTransport)}
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
              onChange={(e) => setCommand(e.target.value)}
              placeholder="/usr/local/bin/mcp-filesystem"
            />
          </div>
          <div className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">
              Args (one per line)
            </span>
            <Textarea
              value={argsText}
              onChange={(e) => setArgsText(e.target.value)}
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
              onChange={(e) => setEnvText(e.target.value)}
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
              onChange={(e) => setCwd(e.target.value)}
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
              onChange={(e) => setUrl(e.target.value)}
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
                onChange={(e) => setHeadersText(e.target.value)}
                rows={3}
                className="font-mono text-sm"
              />
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
          disabled={submitting || !!nameError || name.length === 0}
        >
          {submitting ? "Saving…" : initial ? "Save changes" : "Add server"}
        </Button>
      </div>
    </div>
  )
}

// ── Settings page wrapper ─────────────────────────────────────────────────

export function McpServersSettingsBranch(props: {
  state: Pick<KannaState, "handleWriteAppSettings" | "handleTestMcpServer">
}) {
  const servers = useAppSettingsStore(selectCustomMcpServers)
  const [editing, setEditing] = useState<EditingState>({ kind: "list" })

  const handlers = useMemo<McpServersSectionHandlers>(
    () => ({
      onCreate: async (input) => {
        await props.state.handleWriteAppSettings({
          customMcpServers: { create: input },
        } as AppSettingsPatch)
      },
      onUpdate: async (id, patch) => {
        await props.state.handleWriteAppSettings({
          customMcpServers: { update: { id, patch } },
        } as AppSettingsPatch)
      },
      onDelete: async (id) => {
        await props.state.handleWriteAppSettings({
          customMcpServers: { delete: { id } },
        } as AppSettingsPatch)
        setEditing({ kind: "list" })
      },
      onSetEnabled: async (id, enabled) => {
        await props.state.handleWriteAppSettings({
          customMcpServers: { setEnabled: { id, enabled } },
        } as AppSettingsPatch)
      },
      onTest: async (id) => {
        await props.state.handleTestMcpServer(id)
      },
    }),
    [props.state],
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
