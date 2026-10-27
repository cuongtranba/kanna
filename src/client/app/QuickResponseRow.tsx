import { useCallback, useEffect, type ReactNode } from "react"
import { errorMessage } from "../../shared/errors"
import { isLlmProviderKind, type LlmProviderKind } from "../../shared/types"
import { SettingsRow } from "../components/settings/SettingsList"
import { Button } from "../components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { Spinner } from "../components/ui/spinner"
import { asJsonValue } from "../lib/asJsonValue"
import { createLlmProviderDraftForSelection } from "../lib/llmProviderDraft"
import { handleTextInputKeyDown } from "../lib/settings-input"
import { cn } from "../lib/utils"
import { runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useProvidersSectionStore } from "../stores/providersSectionStore"
import type { KannaState } from "./useKannaState"
import { LLM_PROVIDER_READ_KEY } from "./useAppGlobalState"

const LLM_PROVIDER_WRITE_KEY = "settings.writeLlmProvider"

const QUICK_RESPONSE_PROVIDER_OPTIONS: Array<{ value: LlmProviderKind; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "custom", label: "Custom" },
]

type QuickResponseState = Pick<
  KannaState,
  "llmProvider" | "handleReadLlmProvider" | "handleWriteLlmProvider" | "handleValidateLlmProvider"
>

function ValidationStatus({ saving, busy }: { saving: boolean; busy: boolean }) {
  const status = useProvidersSectionStore((s) => s.llmValidationStatus)
  const validationError = useProvidersSectionStore((s) => s.llmValidationError)
  const setDialogOpen = useProvidersSectionStore((s) => s.setLlmValidationDialogOpen)

  let className: string
  let content: ReactNode
  if (busy) {
    className = "inline-flex items-center gap-1.5 text-muted-foreground"
    content = <><Spinner />{saving ? "Saving…" : "Loading…"}</>
  } else if (status === "valid") {
    className = "text-success-text"
    content = "Credentials valid & saved"
  } else if (status === "invalid") {
    className = "text-destructive"
    content = (
      <>
        <span>Credentials invalid.</span>
        {validationError ? (
          <>
            {" "}
            <button
              type="button"
              onClick={() => setDialogOpen(true)}
              className="underline underline-offset-2"
            >
              See error
            </button>
          </>
        ) : null}
      </>
    )
  } else {
    className = "hidden"
    content = null
  }
  return <span className={cn("mt-2 block text-sm font-medium", className)}>{content}</span>
}

function ValidationErrorDialog() {
  const open = useProvidersSectionStore((s) => s.llmValidationDialogOpen)
  const setOpen = useProvidersSectionStore((s) => s.setLlmValidationDialogOpen)
  const validationError = useProvidersSectionStore((s) => s.llmValidationError)
  const text = validationError ? JSON.stringify(validationError, null, 2) : ""
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="lg">
        <DialogBody className="space-y-4">
          <DialogTitle>Validation Error</DialogTitle>
          <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-muted p-3 text-xs font-mono whitespace-pre-wrap break-words">
            {text}
          </pre>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function QuickResponseRow({ state }: { state: QuickResponseState }) {
  const { llmProvider, handleReadLlmProvider, handleWriteLlmProvider, handleValidateLlmProvider } = state
  const draft = useProvidersSectionStore((s) => s.llmProviderDraft)
  const setDraft = useProvidersSectionStore((s) => s.setLlmProviderDraft)
  const error = useProvidersSectionStore((s) => s.llmProviderError)
  const setError = useProvidersSectionStore((s) => s.setLlmProviderError)
  const llmDraftChanged = useProvidersSectionStore((s) => s.llmDraftChanged)
  const llmValidated = useProvidersSectionStore((s) => s.llmValidated)
  const saving = usePendingAction(LLM_PROVIDER_WRITE_KEY)
  const loading = usePendingAction(LLM_PROVIDER_READ_KEY)
  const busy = saving || loading

  useEffect(() => {
    runPendingAction(LLM_PROVIDER_READ_KEY, handleReadLlmProvider)
  }, [handleReadLlmProvider])

  useEffect(() => {
    if (!llmProvider) return
    setDraft({
      provider: llmProvider.provider,
      apiKey: llmProvider.apiKey,
      model: llmProvider.model,
      baseUrl: llmProvider.baseUrl,
    })
  }, [llmProvider, setDraft])

  useEffect(() => {
    llmDraftChanged()
  }, [draft.provider, draft.apiKey, draft.model, draft.baseUrl, llmDraftChanged])

  const commit = useCallback(
    async (value: typeof draft) => {
      try {
        setError(null)
        await handleWriteLlmProvider(value)
        const validation = await handleValidateLlmProvider(value)
        llmValidated(validation.ok ? "valid" : "invalid", validation.error)
      } catch (cause) {
        const fallbackError = cause instanceof Error
          ? { name: cause.name, message: cause.message }
          : asJsonValue(cause)
        llmValidated("invalid", fallbackError)
        setError(errorMessage(cause))
      }
    },
    [handleWriteLlmProvider, handleValidateLlmProvider, setError, llmValidated],
  )

  function save(value = draft) {
    runPendingAction(LLM_PROVIDER_WRITE_KEY, () => commit(value))
  }

  function handleProviderSelection(nextProvider: LlmProviderKind) {
    const next = createLlmProviderDraftForSelection(draft, nextProvider)
    setDraft(next)
    save(next)
  }

  return (
    <>
      <SettingsRow
        title="Quick Response SDK"
        description={(
          <>
            <span>
              Use an OpenAI-compatible API for title and commit message generation before Claude and Codex. Stored in {llmProvider?.filePathDisplay ?? "the active llm-provider.json file"}.
            </span>
            <ValidationStatus saving={saving} busy={busy} />
          </>
        )}
        alignStart
      >
        <div className="flex w-full max-w-[420px] flex-col gap-3">
          {error ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}
          {llmProvider?.warning ? (
            <div className="rounded-lg border border-border bg-card/30 px-4 py-3 text-sm text-muted-foreground">
              {llmProvider.warning}
            </div>
          ) : null}
          <Select value={draft.provider} disabled={busy} onValueChange={(value) => { if (isLlmProviderKind(value)) handleProviderSelection(value) }}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {QUICK_RESPONSE_PROVIDER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {draft.provider === "custom" ? (
            <Input
              value={draft.baseUrl}
              onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
              onBlur={() => save()}
              onKeyDown={(event) => handleTextInputKeyDown(event, save)}
              readOnly={busy}
              placeholder="https://your-provider.example/v1"
            />
          ) : null}
          <Input
            type="password"
            value={draft.apiKey}
            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
            onBlur={() => save()}
            onKeyDown={(event) => handleTextInputKeyDown(event, save)}
            readOnly={busy}
            placeholder="API key"
          />
          <Input
            value={draft.model}
            onChange={(event) => setDraft({ ...draft, model: event.target.value })}
            onBlur={() => save()}
            onKeyDown={(event) => handleTextInputKeyDown(event, save)}
            readOnly={busy}
            placeholder="Model id"
          />
        </div>
      </SettingsRow>
      <ValidationErrorDialog />
    </>
  )
}
