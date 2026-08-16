import { create } from "zustand"
import type { CronJobsGlobalRow } from "../../shared/cron/types"

const EMPTY: readonly CronJobsGlobalRow[] = []

interface CronJobsState {
  rows: readonly CronJobsGlobalRow[]
  setRows(rows: readonly CronJobsGlobalRow[]): void
}

/** Global cron-jobs topic (all projects/chats) — feeds the /cron management page. */
export const useCronJobsStore = create<CronJobsState>()((set) => ({
  rows: EMPTY,
  setRows: (rows) => set({ rows: rows.length > 0 ? rows : EMPTY }),
}))
