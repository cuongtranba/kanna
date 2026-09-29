import { useCallback } from "react"
import { useActions, type ComponentRenderProps } from "@json-render/react"
import { FileCode2, FileMinus2, FilePen, FilePlus2, Wrench } from "lucide-react"
import { GENUI_COMPONENTS } from "../../../../shared/genui"
import type { JsonObject } from "../../../../shared/json"
import { Button } from "../../ui/button"
import { cn } from "../../../lib/utils"
import { formatCompactDuration } from "../../../lib/formatDuration"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../../stores/pendingActionsStore"
import { useGenUIView } from "../view-context"
import { PropsIssue, ToneIcon, toneInkClass, type Tone } from "./primitives"
import { resolvedProps } from "./props"

function useRunAction(action: string, params: JsonObject, id: string) {
  const { execute } = useActions()
  const { viewKey } = useGenUIView()
  const key = pendingActionKey(`genui.${action}`, viewKey, id)
  const pending = usePendingAction(key)
  const run = useCallback(() => {
    runPendingAction(key, () => execute({ action, params }))
  }, [action, execute, key, params])
  return { run, pending }
}

function FileLink({ path, line, label }: { path: string; line?: number; label: string }) {
  const params: JsonObject = line ? { path, line } : { path }
  const { run, pending } = useRunAction("file.open", params, `${path}:${line ?? ""}`)
  return (
    <button
      type="button"
      onClick={run}
      disabled={pending}
      aria-busy={pending || undefined}
      className="min-w-0 truncate text-left font-mono text-xs text-foreground underline decoration-border underline-offset-2 hover:decoration-foreground"
    >
      {label}
    </button>
  )
}

export function KeyValueElement({ element }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.KeyValue.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="KeyValue" />
  return (
    <dl className={cn("grid gap-x-6 gap-y-1.5", parsed.data.columns === 2 ? "grid-cols-1 @md:grid-cols-2" : "grid-cols-1")}>
      {parsed.data.items.map((item) => (
        <div key={item.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 text-sm">
          <dt className="text-muted-foreground">{item.label}</dt>
          <dd className="break-words text-foreground tabular-nums">{item.value === null ? "—" : String(item.value)}</dd>
        </div>
      ))}
    </dl>
  )
}

const FILE_STATUS = {
  added: { icon: FilePlus2, label: "Added" },
  modified: { icon: FilePen, label: "Modified" },
  deleted: { icon: FileMinus2, label: "Deleted" },
  renamed: { icon: FileCode2, label: "Renamed" },
} as const

export function FileListElement({ element }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.FileList.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="FileList" />
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {parsed.data.files.map((file) => {
        const status = file.status ? FILE_STATUS[file.status] : null
        const Icon = status?.icon ?? FileCode2
        return (
          <li key={file.path} className="flex items-center gap-2 px-3 py-2">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <FileLink path={file.path} label={file.path} />
              {file.description ? <p className="text-xs text-muted-foreground">{file.description}</p> : null}
            </div>
            {status ? <span className="shrink-0 text-xs text-muted-foreground">{status.label}</span> : null}
          </li>
        )
      })}
    </ul>
  )
}

function formatLocation(path: string, line: number | undefined, column: number | undefined): string {
  if (!line) return path
  return column ? `${path}:${line}:${column}` : `${path}:${line}`
}

const SEVERITY_TONE: Readonly<Record<"error" | "warning" | "info", Tone>> = { error: "negative", warning: "attention", info: "info" }
const SEVERITY_LABEL = { error: "Error", warning: "Warning", info: "Info" } as const

export function DiagnosticListElement({ element }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.DiagnosticList.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="DiagnosticList" />
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {parsed.data.items.map((item, index) => {
        const tone = SEVERITY_TONE[item.severity]
        const location = item.path ? formatLocation(item.path, item.line, item.column) : null
        return (
          <li key={`${index}-${item.message}`} className="flex gap-2 px-3 py-2 text-sm">
            <span className={cn("mt-0.5 flex shrink-0 items-center gap-1 text-xs font-medium", toneInkClass(tone))}>
              <ToneIcon tone={tone} />
              {SEVERITY_LABEL[item.severity]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-foreground">{item.message}</p>
              <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                {item.path && location ? <FileLink path={item.path} line={item.line} label={location} /> : null}
                {item.source ? <span>{item.source}</span> : null}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function FixFailureButton({ name, context }: { name: string; context: JsonObject }) {
  const { run, pending } = useRunAction("agent.fix", { subject: name, context }, name)
  return (
    <Button size="sm" variant="ghost" onClick={run} pending={pending} aria-label={`Ask the agent to fix ${name}`}>
      {pending ? null : <Wrench className="h-3.5 w-3.5" aria-hidden="true" />}
      Fix
    </Button>
  )
}

export function TestResultElement({ element }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.TestResult.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="TestResult" />
  const { passed, failed, skipped, durationMs, command, failures } = parsed.data
  const overall: Tone = failed > 0 ? "negative" : "positive"
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className={cn("flex items-center gap-1 font-medium", toneInkClass(overall))}>
          <ToneIcon tone={overall} />
          {failed > 0 ? "Failing" : "Passing"}
        </span>
        <span className="tabular-nums text-foreground">{passed} passed</span>
        <span className="tabular-nums text-foreground">{failed} failed</span>
        {skipped !== undefined ? <span className="tabular-nums text-muted-foreground">{skipped} skipped</span> : null}
        {durationMs !== undefined ? <span className="tabular-nums text-muted-foreground">{formatCompactDuration(durationMs)}</span> : null}
      </div>
      {command ? <code className="w-fit rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">{command}</code> : null}
      {failures && failures.length > 0 ? (
        <ul className="divide-y divide-border border-t border-border">
          {failures.map((failure) => (
            <li key={failure.name} className="flex items-start gap-2 py-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm text-foreground">{failure.name}</p>
                {failure.message ? <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground">{failure.message}</pre> : null}
                {failure.path ? <FileLink path={failure.path} line={failure.line} label={formatLocation(failure.path, failure.line, undefined)} /> : null}
              </div>
              <FixFailureButton
                name={failure.name}
                context={{
                  ...(failure.message ? { message: failure.message } : {}),
                  ...(failure.path ? { path: failure.path } : {}),
                  ...(failure.line ? { line: failure.line } : {}),
                  ...(command ? { command } : {}),
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function TimelineElement({ element }: ComponentRenderProps) {
  const parsed = GENUI_COMPONENTS.Timeline.props.safeParse(resolvedProps(element.props))
  if (!parsed.success) return <PropsIssue component="Timeline" />
  return (
    <ol className="flex flex-col gap-3 border-l border-border pl-4">
      {parsed.data.items.map((item, index) => (
        <li key={`${index}-${item.title}`} className="flex flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            {item.tone ? <ToneIcon tone={item.tone} className={toneInkClass(item.tone)} /> : null}
            <span className="text-sm font-medium text-foreground">{item.title}</span>
            {item.time ? <span className="text-xs tabular-nums text-muted-foreground">{item.time}</span> : null}
          </div>
          {item.detail ? <p className="text-sm text-muted-foreground">{item.detail}</p> : null}
        </li>
      ))}
    </ol>
  )
}
