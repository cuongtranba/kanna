import { createScopedStore } from "../lib/createScopedStore"
import type { CronJobSnapshot, CronMode } from "../../shared/cron/types"

export interface CronJobEditDraft {
  instruction: string
  scheduleText: string
  mode: CronMode
  setInstruction: (instruction: string) => void
  setScheduleText: (scheduleText: string) => void
  setMode: (mode: CronMode) => void
}

export const CronJobEditStore = createScopedStore<CronJobSnapshot, CronJobEditDraft>(
  "CronJobEditDialog",
  (job) => (set) => ({
    instruction: job.instruction,
    scheduleText: job.scheduleText,
    mode: job.mode,
    setInstruction: (instruction) => set({ instruction }),
    setScheduleText: (scheduleText) => set({ scheduleText }),
    setMode: (mode) => set({ mode }),
  }),
)
