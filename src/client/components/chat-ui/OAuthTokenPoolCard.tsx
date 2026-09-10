import { Trash2, FlaskConical, Power, PowerOff } from "lucide-react"
import {
  type ClaudeAuthSettings,
  type OAuthTokenEntry,
  OAUTH_TOKEN_BASE_URL_MAX,
  OAUTH_TOKEN_MAX_CONCURRENT_MIN,
  clampTokenConcurrency,
  normalizeAnthropicBaseUrl,
} from "../../../shared/types"
import { maskToken } from "../../lib/oauthTokenMask"
import { Input } from "../ui/input"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "../ui/tooltip"
import { HoverHint } from "../ui/truncated-text"
import { useOAuthTokenPoolCardStore } from "../../stores/oauthTokenPoolCardStore"
import type { TimerPort } from "../../ports/timerPort"
import { timerAdapter } from "../../adapters/timer.adapter"


function formatLimitedUntil(msUntilReset: number): string {
  if (msUntilReset <= 0) return "reset now"
  const totalSec = Math.ceil(msUntilReset / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  if (min < 60) return `reset in ${min}m ${sec.toString().padStart(2, "0")}s`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return `reset in ${hr}h ${remMin.toString().padStart(2, "00")}m`
}


interface TokenRowPorts {
  timer?: TimerPort
}

export interface OAuthTokenPoolCardProps {
  tokens: OAuthTokenEntry[]
  concurrencyDefault: number
  onWrite: (patch: Partial<ClaudeAuthSettings>) => Promise<void>
  onTest: (token: string, baseUrl?: string) => Promise<{ ok: boolean; error: string | null }>
  now?: number
  ports?: TokenRowPorts
}


function StatusPill({ entry, now }: { entry: OAuthTokenEntry; now: number }) {
  if (entry.status === "active") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />
        Active
      </span>
    )
  }

  if (entry.status === "limited") {
    const countdown =
      entry.limitedUntil !== null ? formatLimitedUntil(entry.limitedUntil - now) : null
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <span className="size-1.5 rounded-full bg-amber-500" aria-hidden="true" />
        Limited
        {countdown !== null && (
          <>
            {" "}
            (<span className="tabular-nums">{countdown}</span>)
          </>
        )}
      </span>
    )
  }

  if (entry.status === "disabled") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/60">
        <span className="size-1.5 rounded-full bg-muted-foreground/30" aria-hidden="true" />
        Disabled
      </span>
    )
  }

  const message = entry.lastErrorMessage ?? "Unknown error"
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-default items-center gap-1.5 text-xs text-destructive">
            <span className="size-1.5 rounded-full bg-destructive" aria-hidden="true" />
            Error
            <span className="sr-only">{message}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent aria-hidden="true">{message}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}


function TokenRow({
  entry,
  now,
  isCurrent,
  concurrencyDefault,
  onRemove,
  onToggleDisabled,
  onTest,
  onChangeMaxConcurrent,
  onChangeBaseUrl,
  ports,
}: {
  entry: OAuthTokenEntry
  now: number
  isCurrent: boolean
  concurrencyDefault: number
  onRemove: () => void
  onToggleDisabled: () => void
  onTest: (token: string, baseUrl?: string) => Promise<{ ok: boolean; error: string | null }>
  onChangeMaxConcurrent: (id: string, value: number) => void
  onChangeBaseUrl: (id: string, value: string) => void
  ports?: TokenRowPorts
}) {
  const timer = ports?.timer ?? timerAdapter

  const tokenRowStates = useOAuthTokenPoolCardStore((state) => state.tokenRowStates)
  const setTokenRowTesting = useOAuthTokenPoolCardStore((state) => state.setTokenRowTesting)
  const setTokenRowTestResult = useOAuthTokenPoolCardStore((state) => state.setTokenRowTestResult)
  const baseUrlDrafts = useOAuthTokenPoolCardStore((state) => state.baseUrlDrafts)
  const setBaseUrlDraft = useOAuthTokenPoolCardStore((state) => state.setBaseUrlDraft)

  const rowState = tokenRowStates[entry.id]
  const testResult = rowState?.testResult ?? null
  const testing = rowState?.testing ?? false
  const baseUrlValue = baseUrlDrafts[entry.id] ?? entry.baseUrl ?? ""
  const baseUrlInvalid =
    baseUrlValue.trim().length > 0 && normalizeAnthropicBaseUrl(baseUrlValue) === null

  const commitBaseUrl = () => onChangeBaseUrl(entry.id, baseUrlValue)

  const handleBaseUrlKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur()
  }

  const handleTest = async () => {
    setTokenRowTesting(entry.id, true)
    setTokenRowTestResult(entry.id, null)
    try {
      const res = await onTest(entry.token, entry.baseUrl)
      const label = res.ok ? "OK" : (res.error ?? "Error")
      setTokenRowTestResult(entry.id, label)
      timer.setTimeout(() => setTokenRowTestResult(entry.id, null), 3000)
    } catch {
      setTokenRowTestResult(entry.id, "Error")
      timer.setTimeout(() => setTokenRowTestResult(entry.id, null), 3000)
    } finally {
      setTokenRowTesting(entry.id, false)
    }
  }

  const isDisabled = entry.status === "disabled"
  const effectiveCap = entry.maxConcurrent ?? concurrencyDefault

  return (
    <div className="border-t border-border py-3">
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${isDisabled ? "text-muted-foreground/60" : "text-foreground"}`}>{entry.label}</span>
          <code className="text-xs font-mono text-muted-foreground">{maskToken(entry.token)}</code>
          {isCurrent && (
            <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-xs font-medium tracking-wide text-primary">
              In use
            </span>
          )}
        </div>
        <div className="mt-0.5">
          <StatusPill entry={entry} now={now} />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <HoverHint label="Maximum concurrent chats sharing this OAuth token. Higher = risks Anthropic rate limits.">
        <label className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <span>Concurrent</span>
          <Input
            type="number"
            value={effectiveCap}
            onChange={(e) => onChangeMaxConcurrent(entry.id, clampTokenConcurrency(Number(e.target.value)))}
            min={OAUTH_TOKEN_MAX_CONCURRENT_MIN}
            aria-label="Max concurrent chats"
            className="h-7 w-14 text-xs"
            disabled={isDisabled}
          />
        </label>
        </HoverHint>
        {testResult !== null && (
          <span className="text-xs text-muted-foreground">{testResult}</span>
        )}
        <button
          type="button"
          aria-label="Test"
          onClick={handleTest}
          disabled={testing || isDisabled}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FlaskConical className="size-3" aria-hidden="true" />
          Test
        </button>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={isDisabled ? "Enable" : "Disable"}
                onClick={onToggleDisabled}
                className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {isDisabled
                  ? <Power className="size-3.5" aria-hidden="true" />
                  : <PowerOff className="size-3.5" aria-hidden="true" />}
                <span className="sr-only">{isDisabled ? "Enable" : "Disable"}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{isDisabled ? "Enable" : "Disable"}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <button
          type="button"
          aria-label="Remove"
          onClick={onRemove}
          className="rounded p-1 text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Remove</span>
        </button>
      </div>
    </div>

    <HoverHint label="Anthropic API endpoint this token authenticates against. Leave empty for the default api.anthropic.com; set it to route this credential through a proxy.">
    <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
      <span className="shrink-0">Base URL</span>
      <Input
        value={baseUrlValue}
        onChange={(e) => setBaseUrlDraft(entry.id, e.target.value)}
        onBlur={commitBaseUrl}
        onKeyDown={handleBaseUrlKeyDown}
        placeholder="(default)"
        maxLength={OAUTH_TOKEN_BASE_URL_MAX}
        aria-label={`Anthropic base URL for ${entry.label}`}
        className="h-7 flex-1 text-xs font-mono"
        disabled={isDisabled}
      />
    </label>
    </HoverHint>
    {baseUrlInvalid && (
      <div className="mt-1 text-xs text-destructive">
        Must start with http:// or https://
      </div>
    )}
    </div>
  )
}


function AddTokenForm({
  tokens,
  onWrite,
}: {
  tokens: OAuthTokenEntry[]
  onWrite: OAuthTokenPoolCardProps["onWrite"]
}) {
  const addLabel = useOAuthTokenPoolCardStore((state) => state.addLabel)
  const addToken = useOAuthTokenPoolCardStore((state) => state.addToken)
  const addBaseUrl = useOAuthTokenPoolCardStore((state) => state.addBaseUrl)
  const addSubmitting = useOAuthTokenPoolCardStore((state) => state.addSubmitting)
  const setAddLabel = useOAuthTokenPoolCardStore((state) => state.setAddLabel)
  const setAddToken = useOAuthTokenPoolCardStore((state) => state.setAddToken)
  const setAddBaseUrl = useOAuthTokenPoolCardStore((state) => state.setAddBaseUrl)
  const setAddSubmitting = useOAuthTokenPoolCardStore((state) => state.setAddSubmitting)
  const resetAddForm = useOAuthTokenPoolCardStore((state) => state.resetAddForm)

  const normalizedAddBaseUrl = normalizeAnthropicBaseUrl(addBaseUrl)
  const addBaseUrlInvalid = addBaseUrl.trim().length > 0 && normalizedAddBaseUrl === null
  const canSubmit =
    addLabel.trim().length > 0 && addToken.trim().length > 0 && !addBaseUrlInvalid && !addSubmitting

  const handleAdd = async () => {
    if (!canSubmit) return
    setAddSubmitting(true)
    try {
      const newEntry: OAuthTokenEntry = {
        id: crypto.randomUUID(),
        label: addLabel.trim(),
        token: addToken.trim(),
        status: "active",
        limitedUntil: null,
        lastUsedAt: null,
        lastErrorAt: null,
        lastErrorMessage: null,
        addedAt: Date.now(),
        ...(normalizedAddBaseUrl !== null ? { baseUrl: normalizedAddBaseUrl } : {}),
      }
      await onWrite({ tokens: [...tokens, newEntry] })
      resetAddForm()
    } finally {
      setAddSubmitting(false)
    }
  }

  return (
    <div className="border-t border-border pt-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
        <div className="flex-1">
          <Input
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            placeholder="e.g. personal"
            maxLength={64}
            className="text-sm"
            aria-label="Token label"
          />
        </div>
        <div className="flex-[2]">
          <Input
            value={addToken}
            onChange={(e) => setAddToken(e.target.value)}
            type="password"
            placeholder="sk-ant-..."
            maxLength={1024}
            className="text-sm font-mono"
            aria-label="OAuth token"
          />
        </div>
        <button
          type="button"
          onClick={handleAdd}
          disabled={!canSubmit}
          className="inline-flex shrink-0 items-center rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          Add token
        </button>
      </div>
      <div className="mt-2">
        <Input
          value={addBaseUrl}
          onChange={(e) => setAddBaseUrl(e.target.value)}
          placeholder="Base URL — leave empty for api.anthropic.com"
          maxLength={OAUTH_TOKEN_BASE_URL_MAX}
          className="text-sm font-mono"
          aria-label="Anthropic base URL"
        />
        {addBaseUrlInvalid && (
          <div className="mt-1 text-xs text-destructive">
            Must start with http:// or https://
          </div>
        )}
      </div>
    </div>
  )
}


export function OAuthTokenPoolCard({
  tokens,
  concurrencyDefault,
  onWrite,
  onTest,
  now: nowProp,
  ports,
}: OAuthTokenPoolCardProps) {
  // eslint-disable-next-line react-hooks/purity
  const now = nowProp ?? Date.now()

  const clearBaseUrlDraft = useOAuthTokenPoolCardStore((state) => state.clearBaseUrlDraft)

  const currentId = tokens.reduce<OAuthTokenEntry | null>(
    (m, t) => (t.lastUsedAt !== null && (m === null || t.lastUsedAt > (m.lastUsedAt ?? 0)) ? t : m),
    null,
  )?.id ?? null

  const handleRemove = (id: string) => {
    void onWrite({ tokens: tokens.filter((t) => t.id !== id) })
  }

  const handleToggleDisabled = (id: string) => {
    void onWrite({
      tokens: tokens.map((t) =>
        t.id === id
          ? { ...t, status: t.status === "disabled" ? "active" : "disabled" }
          : t,
      ),
    })
  }

  const handleChangeMaxConcurrent = (id: string, value: number) => {
    void onWrite({
      tokens: tokens.map((t) =>
        t.id === id ? { ...t, maxConcurrent: value } : t,
      ),
    })
  }

  const handleChangeBaseUrl = (id: string, value: string) => {
    const entry = tokens.find((t) => t.id === id)
    if (!entry) return
    const normalized = normalizeAnthropicBaseUrl(value)
    if (normalized === null && value.trim().length > 0) return
    clearBaseUrlDraft(id)
    if (normalized === (entry.baseUrl ?? null)) return
    void onWrite({
      tokens: tokens.map((t) => {
        if (t.id !== id) return t
        const { baseUrl: _dropped, ...withoutBaseUrl } = t
        return normalized === null ? withoutBaseUrl : { ...t, baseUrl: normalized }
      }),
    })
  }

  const handleChangeGlobalDefault = (value: number) => {
    void onWrite({ concurrencyDefault: clampTokenConcurrency(value) })
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 pb-3">
        <HoverHint label="Default concurrent-chat cap applied to any OAuth token whose row does not override it. Sharing across N chats burns Anthropic quota and risks 429s.">
        <label className="flex flex-col gap-0.5 text-sm">
          <span className="font-medium text-foreground">Default concurrency per token</span>
          <span className="text-xs text-muted-foreground">Cap for tokens without an explicit per-row override. Minimum {OAUTH_TOKEN_MAX_CONCURRENT_MIN}, no upper limit.</span>
        </label>
        </HoverHint>
        <Input
          type="number"
          value={concurrencyDefault}
          onChange={(e) => handleChangeGlobalDefault(Number(e.target.value))}
          min={OAUTH_TOKEN_MAX_CONCURRENT_MIN}
          aria-label="Default concurrency per token"
          className="h-8 w-16 text-sm"
        />
      </div>
      {tokens.map((entry) => (
        <TokenRow
          key={entry.id}
          entry={entry}
          now={now}
          isCurrent={entry.id === currentId}
          concurrencyDefault={concurrencyDefault}
          onRemove={() => handleRemove(entry.id)}
          onToggleDisabled={() => handleToggleDisabled(entry.id)}
          onTest={onTest}
          onChangeMaxConcurrent={handleChangeMaxConcurrent}
          onChangeBaseUrl={handleChangeBaseUrl}
          ports={ports}
        />
      ))}

      <AddTokenForm tokens={tokens} onWrite={onWrite} />
    </div>
  )
}
