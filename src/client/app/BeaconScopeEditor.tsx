import { useCallback, type ChangeEvent } from "react"
import { Info, X } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { HoverHint } from "../components/ui/truncated-text"
import { beaconDraftKey, useBeaconsSectionStore } from "../stores/beaconsSectionStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import type { BeaconScope } from "../../shared/beacon-scope"

const EXEC_EXPLANATION =
  "Lets the agent run commands and scripts on this machine. Off means every command and script is refused, and the agent can only read and copy files inside the folders below. "
  + "When on, each command still waits for your approval unless it is on the always-run list or you switch on running without asking."

const AUTO_RUN_EXPLANATION =
  "Skips the approval prompt. Reads and writes inside the folders below, and every command and script, run immediately. "
  + "Leave it off to review each action before it runs on this machine."

const READ_ROOTS_EXPLANATION =
  "The agent can list, search, read and copy files off this machine only inside these folders and their subfolders. Anything outside is refused. "
  + "With none listed it cannot read from this machine at all. Each read waits for your approval unless running without asking is on."

const WRITE_ROOTS_EXPLANATION =
  "The agent can copy files onto this machine only inside these folders and their subfolders. Leave empty and it cannot write to this machine at all. "
  + "Each write waits for your approval unless running without asking is on."

const ALLOWLIST_EXPLANATION =
  "Command names, such as git, that run immediately once running commands is allowed. Matching uses the command name only, "
  + "so git covers every git subcommand. Anything not listed asks you first."

export function explanationPanelId(explanationKey: string): string {
  return `beacon-explain-${explanationKey}`
}

function ExplainToggle({ explanationKey, subject }: { explanationKey: string; subject: string }) {
  const open = useBeaconsSectionStore((s) => explanationKey in s.openExplanations)
  const toggleExplanation = useBeaconsSectionStore((s) => s.toggleExplanation)

  const onClick = useCallback(() => {
    toggleExplanation(explanationKey)
  }, [explanationKey, toggleExplanation])

  return (
    <HoverHint label="What does this do?">
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onClick}
        aria-expanded={open}
        aria-controls={explanationPanelId(explanationKey)}
        aria-label={`What does "${subject}" do?`}
      >
        <Info className="h-4 w-4" />
      </Button>
    </HoverHint>
  )
}

function Explanation({ explanationKey, text }: { explanationKey: string; text: string }) {
  const open = useBeaconsSectionStore((s) => explanationKey in s.openExplanations)
  return (
    <p id={explanationPanelId(explanationKey)} hidden={!open} className="text-13 text-muted-foreground">
      {text}
    </p>
  )
}

export function BeaconScopeEditor({
  beaconId,
  scope,
  onSetScope,
}: {
  beaconId: string
  scope: BeaconScope
  onSetScope: (id: string, scope: BeaconScope) => Promise<void>
}) {
  const scopeKey = pendingActionKey("beacons.setScope", beaconId)
  const pending = usePendingAction(scopeKey)

  const commit = useCallback((next: BeaconScope) => {
    runPendingAction(scopeKey, () => onSetScope(beaconId, next))
  }, [beaconId, onSetScope, scopeKey])

  const onExec = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    commit({ ...scope, exec: event.target.checked })
  }, [commit, scope])

  const onAutoRun = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    commit({ ...scope, autoRunScripts: event.target.checked })
  }, [commit, scope])

  const onReadRoots = useCallback((readRoots: readonly string[]) => {
    commit({ ...scope, readRoots })
  }, [commit, scope])

  const onWriteRoots = useCallback((writeRoots: readonly string[]) => {
    commit({ ...scope, writeRoots })
  }, [commit, scope])

  const onAllowlist = useCallback((execAllowlist: readonly string[]) => {
    commit({ ...scope, execAllowlist })
  }, [commit, scope])

  return (
    <div className="flex flex-col gap-4 border-t border-border bg-muted/40 px-4 py-4" aria-busy={pending || undefined}>
      <ScopeToggle
        explanationKey={beaconDraftKey(beaconId, "exec")}
        checked={scope.exec}
        disabled={pending}
        onChange={onExec}
        title="Allow running commands"
        explanation={EXEC_EXPLANATION}
      />
      <ScopeToggle
        explanationKey={beaconDraftKey(beaconId, "autoRunScripts")}
        checked={scope.autoRunScripts}
        disabled={pending}
        onChange={onAutoRun}
        title="Run commands and scripts from this chat without asking each time"
        explanation={AUTO_RUN_EXPLANATION}
      />
      <ScopeList
        label="Folders the agent may read"
        explanation={READ_ROOTS_EXPLANATION}
        placeholder="/Users/me/projects"
        draftKey={beaconDraftKey(beaconId, "readRoots")}
        items={scope.readRoots}
        disabled={pending}
        onChange={onReadRoots}
      />
      <ScopeList
        label="Folders the agent may write to"
        explanation={WRITE_ROOTS_EXPLANATION}
        placeholder="/Users/me/inbox"
        draftKey={beaconDraftKey(beaconId, "writeRoots")}
        items={scope.writeRoots}
        disabled={pending}
        onChange={onWriteRoots}
      />
      <ScopeList
        label="Commands that always run without asking"
        explanation={ALLOWLIST_EXPLANATION}
        placeholder="git"
        draftKey={beaconDraftKey(beaconId, "execAllowlist")}
        items={scope.execAllowlist}
        disabled={pending}
        onChange={onAllowlist}
      />
    </div>
  )
}

function ScopeToggle({
  explanationKey,
  checked,
  disabled,
  onChange,
  title,
  explanation,
}: {
  explanationKey: string
  checked: boolean
  disabled: boolean
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  title: string
  explanation: string
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <label className="flex min-w-0 cursor-pointer items-center gap-3">
          <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
          <span className="text-sm font-medium text-foreground">{title}</span>
        </label>
        <ExplainToggle explanationKey={explanationKey} subject={title} />
      </div>
      <div className="pl-7">
        <Explanation explanationKey={explanationKey} text={explanation} />
      </div>
    </div>
  )
}

function ScopeList({
  label,
  explanation,
  placeholder,
  draftKey,
  items,
  disabled,
  onChange,
}: {
  label: string
  explanation: string
  placeholder: string
  draftKey: string
  items: readonly string[]
  disabled: boolean
  onChange: (items: readonly string[]) => void
}) {
  const draft = useBeaconsSectionStore((s) => s.drafts[draftKey] ?? "")
  const setDraft = useBeaconsSectionStore((s) => s.setDraft)
  const clearDraft = useBeaconsSectionStore((s) => s.clearDraft)
  const value = draft.trim()
  const canAdd = value.length > 0 && !items.includes(value)

  const onDraft = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDraft(draftKey, event.target.value)
  }, [draftKey, setDraft])

  const onAdd = useCallback(() => {
    onChange([...items, value])
    clearDraft(draftKey)
  }, [clearDraft, draftKey, items, onChange, value])

  const onRemove = useCallback((item: string) => {
    onChange(items.filter((entry) => entry !== item))
  }, [items, onChange])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <ExplainToggle explanationKey={draftKey} subject={label} />
      </div>
      <Explanation explanationKey={draftKey} text={explanation} />
      {items.length === 0 ? (
        <span className="text-13 text-muted-foreground">None</span>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <ScopeListItem key={item} item={item} disabled={disabled} onRemove={onRemove} />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Input value={draft} onChange={onDraft} placeholder={placeholder} disabled={disabled} aria-label={label} />
        <Button variant="secondary" size="sm" onClick={onAdd} disabled={disabled || !canAdd}>
          Add
        </Button>
      </div>
    </div>
  )
}

function ScopeListItem({
  item,
  disabled,
  onRemove,
}: {
  item: string
  disabled: boolean
  onRemove: (item: string) => void
}) {
  const onClick = useCallback(() => {
    onRemove(item)
  }, [item, onRemove])

  return (
    <li className="flex items-center gap-2">
      <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-muted px-2 py-1 font-mono text-13">
        {item}
      </code>
      <Button variant="ghost" size="icon-sm" onClick={onClick} disabled={disabled} aria-label={`Remove ${item}`}>
        <X className="h-4 w-4" />
      </Button>
    </li>
  )
}
