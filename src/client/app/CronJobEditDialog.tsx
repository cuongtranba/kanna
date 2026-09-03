import { useCallback, useMemo } from "react"
import type { CronJobPatch, CronJobSnapshot, CronMode } from "../../shared/cron/types"
import { cronModeConsequence } from "../../shared/cron/arm-summary"
import { humanizeSchedule } from "../../shared/cron/humanize"
import { parseSchedule } from "../../shared/cron/parse-schedule"
import { Button } from "../components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "../components/ui/dialog"
import { Input } from "../components/ui/input"
import { SegmentedControl, type SegmentedOption } from "../components/ui/segmented-control"
import { Textarea } from "../components/ui/textarea"
import { CronJobEditStore } from "./CronJobEditDialog.store"

interface Props {
  job: CronJobSnapshot
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (patch: CronJobPatch) => void
}

// No tooltips: the consequence of the SELECTED mode is spelled out in full
// under the control, where it is read rather than hovered for.
const MODE_OPTIONS: SegmentedOption<CronMode>[] = [
  { value: "inline", label: "inline" },
  { value: "spawn", label: "spawn" },
]

function CronJobEditForm({ job, open, onOpenChange, onSave }: Props) {
  const instruction = CronJobEditStore.useScopedStore((state) => state.instruction)
  const scheduleText = CronJobEditStore.useScopedStore((state) => state.scheduleText)
  const mode = CronJobEditStore.useScopedStore((state) => state.mode)
  const setInstruction = CronJobEditStore.useScopedStore((state) => state.setInstruction)
  const setScheduleText = CronJobEditStore.useScopedStore((state) => state.setScheduleText)
  const setMode = CronJobEditStore.useScopedStore((state) => state.setMode)

  const parsed = useMemo(() => parseSchedule(scheduleText.trim()), [scheduleText])

  const patch = useMemo<CronJobPatch>(() => {
    const next: CronJobPatch = {}
    const trimmedInstruction = instruction.trim()
    if (trimmedInstruction && trimmedInstruction !== job.instruction) next.instruction = trimmedInstruction
    if (mode !== job.mode) next.mode = mode
    const trimmedSchedule = scheduleText.trim()
    // `schedule` and `scheduleText` are one decision: the server merges the
    // parsed schedule and renders the text, so a patch carrying either alone
    // would leave the row describing a schedule it does not run.
    if (parsed.ok && trimmedSchedule !== job.scheduleText) {
      next.schedule = parsed.schedule
      next.scheduleText = trimmedSchedule
    }
    return next
  }, [instruction, job.instruction, job.mode, job.scheduleText, mode, parsed, scheduleText])

  const instructionEmpty = instruction.trim().length === 0
  const canSave = !instructionEmpty && parsed.ok && Object.keys(patch).length > 0

  const applySuggestion = useCallback(() => {
    if (parsed.ok || parsed.correctedSchedule === undefined) return
    setScheduleText(parsed.correctedSchedule)
  }, [parsed, setScheduleText])

  const handleSave = useCallback(() => {
    if (!canSave) return
    onSave(patch)
    onOpenChange(false)
  }, [canSave, onOpenChange, onSave, patch])

  const handleCancel = useCallback(() => {
    onOpenChange(false)
  }, [onOpenChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogBody className="space-y-4">
          <DialogTitle>Edit cron job</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{job.jobId}</span> — saving re-arms the job, which clears its run history and
            resets its created age.
          </DialogDescription>

          <div className="space-y-1.5">
            <label htmlFor="cron-edit-instruction" className="text-sm font-medium text-foreground">
              Instruction
            </label>
            <Textarea
              id="cron-edit-instruction"
              rows={4}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
            />
            {instructionEmpty ? <p className="text-xs text-destructive">An instruction is required.</p> : null}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="cron-edit-schedule" className="text-sm font-medium text-foreground">
              Schedule
            </label>
            <Input
              id="cron-edit-schedule"
              value={scheduleText}
              onChange={(event) => setScheduleText(event.target.value)}
              placeholder="0 9 * * 1, @daily, or every 5m"
              className="font-mono"
            />
            {parsed.ok ? (
              <p className="text-xs text-muted-foreground">{humanizeSchedule(parsed.schedule, scheduleText.trim())}</p>
            ) : (
              <p className="text-xs text-destructive">{parsed.message}</p>
            )}
            {!parsed.ok && parsed.correctedSchedule !== undefined ? (
              <Button variant="secondary" size="sm" onClick={applySuggestion}>
                Use <span className="ml-1 font-mono">{parsed.correctedSchedule}</span>
              </Button>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-foreground">Mode</span>
            <SegmentedControl value={mode} onValueChange={setMode} options={MODE_OPTIONS} size="sm" />
            <p className="text-xs text-muted-foreground">{cronModeConsequence(mode)}</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={handleCancel}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!canSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Everything about an armed cron job that can be changed: instruction,
 * schedule, and run mode. Saves as ONE `CronJobPatch` — the WS `cron.update`
 * command merges a whole patch and emits a single `cron_armed`, so all three
 * fields move together rather than one re-arm per field the way the typed
 * `/cron update <field>` does.
 *
 * The schedule is validated here with `parseSchedule`, the very function the
 * server runs on a typed line, so the dialog cannot offer to save something the
 * server would refuse. Fire TIMES are deliberately not previewed: those are
 * computed server-side from the `cron` package, and the row shows the
 * recomputed "next in …" as soon as the update broadcasts back.
 *
 * The draft is seeded from the job at Provider mount. The caller mounts this
 * only while open and keys it by the job's arming, so every opening starts from
 * the current job with no effect to resynchronize.
 */
export function CronJobEditDialog(props: Props) {
  return (
    <CronJobEditStore.Provider init={props.job}>
      <CronJobEditForm {...props} />
    </CronJobEditStore.Provider>
  )
}
