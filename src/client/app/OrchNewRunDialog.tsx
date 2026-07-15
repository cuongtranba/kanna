import { useCallback } from "react"
import { Boxes } from "lucide-react"
import type { OrchRunInput } from "../../shared/orchestration-types"
import { OrchNewRunDialogStore } from "./OrchNewRunDialog.store"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Textarea } from "../components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "../components/ui/dialog"

export type OrchRunSubmitResult = { ok: true; runId: string } | { ok: false; errors: string[] }

export interface OrchNewRunDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (input: OrchRunInput) => Promise<OrchRunSubmitResult>
}

function parseTasks(raw: string): string[] {
  return raw.split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
}

export function OrchNewRunDialog(props: OrchNewRunDialogProps) {
  return (
    <OrchNewRunDialogStore.Provider init={undefined}>
      <OrchNewRunDialogInner {...props} />
    </OrchNewRunDialogStore.Provider>
  )
}

function OrchNewRunDialogInner({ open, onOpenChange, onSubmit }: OrchNewRunDialogProps) {
  const tasksText = OrchNewRunDialogStore.useScopedStore((s) => s.tasksText)
  const verify = OrchNewRunDialogStore.useScopedStore((s) => s.verify)
  const errors = OrchNewRunDialogStore.useScopedStore((s) => s.errors)
  const submitting = OrchNewRunDialogStore.useScopedStore((s) => s.submitting)
  const setTasksText = OrchNewRunDialogStore.useScopedStore((s) => s.setTasksText)
  const setVerify = OrchNewRunDialogStore.useScopedStore((s) => s.setVerify)
  const setErrors = OrchNewRunDialogStore.useScopedStore((s) => s.setErrors)
  const setSubmitting = OrchNewRunDialogStore.useScopedStore((s) => s.setSubmitting)
  const reset = OrchNewRunDialogStore.useScopedStore((s) => s.reset)

  const tasks = parseTasks(tasksText)
  const canSubmit = tasks.length > 0 && !submitting

  const handleSubmit = useCallback(async () => {
    setErrors([])
    setSubmitting(true)
    const input: OrchRunInput = { tasks: parseTasks(tasksText) }
    if (verify.trim() !== "") input.verify = verify.trim()
    const result = await onSubmit(input)
    if (result.ok) {
      reset()
      onOpenChange(false)
    } else {
      setErrors(result.errors)
      setSubmitting(false)
    }
  }, [tasksText, verify, onSubmit, onOpenChange, reset, setErrors, setSubmitting])

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset()
        onOpenChange(v)
      }}
    >
      <DialogContent aria-describedby="orch-new-run-desc">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Boxes className="size-4" aria-hidden />
            New orchestration run
          </DialogTitle>
          <DialogDescription id="orch-new-run-desc">
            One task per line. Each runs the same pipeline in its own worktree, in parallel.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tasks</span>
            <Textarea
              data-testid="orch-tasks-input"
              value={tasksText}
              onChange={(e) => setTasksText(e.target.value)}
              rows={6}
              placeholder={"Add a logout button to the navbar\nFix the date parsing bug in utils"}
              className="resize-y font-mono text-[13px]"
            />
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {tasks.length} {tasks.length === 1 ? "task" : "tasks"}
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Verify command <span className="normal-case text-muted-foreground/70">(optional)</span>
            </span>
            <Input
              data-testid="orch-verify-input"
              value={verify}
              onChange={(e) => setVerify(e.target.value)}
              placeholder="bun test"
              className="font-mono text-[13px]"
            />
          </label>
          {errors.length > 0 ? (
            <ul className="flex flex-col gap-1 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
              {errors.map((err, i) => (
                <li key={i} className="text-xs text-destructive">{err}</li>
              ))}
            </ul>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onOpenChange(false) }} disabled={submitting}>
            Cancel
          </Button>
          <Button data-testid="orch-run-submit" onClick={() => { void handleSubmit() }} disabled={!canSubmit}>
            {submitting ? "Starting…" : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
