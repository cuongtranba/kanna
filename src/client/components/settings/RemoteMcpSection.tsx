import { useCallback } from "react"
import { Check, Copy } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { SettingsRow } from "./SettingsList"
import { PendingSegmentedControl } from "../../app/PendingSegmentedControl"
import type { KannaState } from "../../app/useKannaState"
import { clipboardAdapter } from "../../adapters/clipboard.adapter"
import { domAdapter } from "../../adapters/dom.adapter"
import type { DomPort } from "../../ports/domPort"
import { timerAdapter } from "../../adapters/timer.adapter"
import { runDetached } from "../../lib/runDetached"
import { selectRemoteMcpSettings, useAppSettingsStore } from "../../stores/appSettingsStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../stores/pendingActionsStore"
import { useRemoteMcpSectionStore } from "../../stores/remoteMcpSectionStore"
import { useSettingsPageStore } from "../../stores/settingsPageStore"
import { errorMessage } from "../../../shared/errors"
import { buildRemoteMcpSetupSnippets, type RemoteMcpSetupSnippet } from "../../../shared/remote-mcp/setup-snippets"
import { normalizeRemoteMcpPublicUrl } from "../../../shared/settings/remote-mcp"

const ENABLED_KEY = pendingActionKey("settings.remoteMcp", "enabled")
const PUBLIC_URL_KEY = pendingActionKey("settings.remoteMcp", "publicUrl")
const COPIED_RESET_MS = 2000

const ENABLED_OPTIONS = [
  { value: "enabled" as const, label: "Enabled" },
  { value: "disabled" as const, label: "Disabled" },
]

function originOf(href: string): string {
  try {
    return new URL(href).origin
  } catch {
    return ""
  }
}

function SnippetCard({ snippet }: { snippet: RemoteMcpSetupSnippet }) {
  const copied = useRemoteMcpSectionStore((s) => s.copiedSnippetId === snippet.id)
  const setCopiedSnippetId = useRemoteMcpSectionStore((s) => s.setCopiedSnippetId)
  const copy = useCallback(async () => {
    await clipboardAdapter.writeText(snippet.snippet)
    setCopiedSnippetId(snippet.id)
    timerAdapter.setTimeout(() => setCopiedSnippetId(null), COPIED_RESET_MS)
  }, [snippet.id, snippet.snippet, setCopiedSnippetId])

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card/30 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{snippet.title}</div>
        <Button
          type="button"
          variant="ghost"
          size="icon-mobile"
          aria-label={copied ? `Copied ${snippet.title} setup` : `Copy ${snippet.title} setup`}
          className="text-muted-foreground hover:text-foreground"
          onClick={() => runDetached("copy remote MCP setup", copy())}
        >
          {copied ? <Check className="h-4 w-4 text-success-text" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <p className="text-13 text-muted-foreground">{snippet.instructions}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted p-2 font-mono text-xs text-foreground">
        {snippet.snippet}
      </pre>
    </div>
  )
}

export function RemoteMcpSection({ state, dom = domAdapter }: { state: Pick<KannaState, "handleWriteAppSettings">; dom?: DomPort }) {
  const settings = useAppSettingsStore(selectRemoteMcpSettings)
  const authEnabled = useSettingsPageStore((s) => s.authEnabled)
  const draft = useRemoteMcpSectionStore((s) => s.publicUrlDraft)
  const setDraft = useRemoteMcpSectionStore((s) => s.setPublicUrlDraft)
  const error = useRemoteMcpSectionStore((s) => s.error)
  const setError = useRemoteMcpSectionStore((s) => s.setError)
  const saving = usePendingAction(PUBLIC_URL_KEY)

  const draftValue = draft ?? settings.publicUrl ?? ""
  const trimmed = draftValue.trim()
  const invalid = trimmed !== "" && normalizeRemoteMcpPublicUrl(trimmed) === null
  const dirty = trimmed !== (settings.publicUrl ?? "")
  const origin = settings.publicUrl ?? normalizeRemoteMcpPublicUrl(originOf(dom.getHref()))
  const snippets = buildRemoteMcpSetupSnippets({ publicOrigin: origin, passwordConfigured: authEnabled })

  const setEnabled = useCallback(
    (value: "enabled" | "disabled") => state.handleWriteAppSettings({ remoteMcp: { enabled: value === "enabled" } }),
    [state],
  )

  const savePublicUrl = useCallback(async () => {
    setError(null)
    try {
      await state.handleWriteAppSettings({ remoteMcp: { publicUrl: trimmed === "" ? null : trimmed } })
      setDraft(null)
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }, [state, trimmed, setDraft, setError])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1 pb-2">
        <h2 className="text-base font-medium">Remote MCP</h2>
        <p className="max-w-[65ch] text-sm text-muted-foreground">
          Let other agents and apps drive Kanna over the Model Context Protocol: Claude Code, Codex, Claude Desktop and ChatGPT can list projects, run chats, move board cards and more.
        </p>
      </div>

      {authEnabled ? null : (
        <div className="rounded-lg border border-border bg-card/30 px-4 py-3 text-sm text-muted-foreground">
          Set --password when starting Kanna to enable the remote MCP server
        </div>
      )}

      <div className="border-b border-border">
        <SettingsRow title="Remote MCP server" description="Serves the /mcp endpoint and the OAuth sign-in pages. Turn it off to answer 404 on all of them.">
          <PendingSegmentedControl
            pendingKey={ENABLED_KEY}
            value={settings.enabled ? "enabled" : "disabled"}
            onValueChange={setEnabled}
            options={ENABLED_OPTIONS}
            size="sm"
          />
        </SettingsRow>
        <SettingsRow
          title="Public URL"
          description="https URL, or http on localhost; the OAuth issuer and resource are derived from it. Leave empty to use this machine's loopback address."
          alignStart
        >
          <div className="flex w-full flex-col gap-2 md:w-[420px]">
            <Input
              value={draftValue}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="https://kanna.example.com"
              aria-label="Public URL"
              aria-invalid={invalid || undefined}
              spellCheck={false}
            />
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className={invalid ? "text-destructive-text" : "text-muted-foreground"}>
                {invalid ? "Enter an https URL, or an http URL on localhost" : "Path, query and trailing slash are dropped"}
              </span>
              <Button
                type="button"
                size="sm"
                disabled={!dirty || invalid}
                onClick={() => runPendingAction(PUBLIC_URL_KEY, savePublicUrl)}
                pending={saving}
              >
                Save
              </Button>
            </div>
            {error ? <div className="text-xs text-destructive-text">{error}</div> : null}
          </div>
        </SettingsRow>
        <SettingsRow
          title="Endpoint"
          description="Give this URL to your MCP client."
          bordered
        >
          {origin ? (
            <code className="break-all rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs">{origin}/mcp</code>
          ) : (
            <span className="text-13 text-muted-foreground">Set a public URL to see the endpoint</span>
          )}
        </SettingsRow>
      </div>

      <div className="flex flex-col gap-3 pt-4">
        <div className="text-sm font-medium text-foreground">Connect a client</div>
        <div className="grid gap-3 md:grid-cols-2">
          {snippets.map((snippet) => (
            <SnippetCard key={snippet.id} snippet={snippet} />
          ))}
        </div>
      </div>
    </div>
  )
}
