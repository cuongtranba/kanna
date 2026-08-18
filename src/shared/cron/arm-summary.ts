import type { CronArmSummary, CronMode } from "./types"

export function cronModeConsequence(mode: CronMode): string {
  return mode === "inline" ? "runs in this chat, context cleared each cycle" : "a new chat per run"
}

export function formatCronArmSummary(summary: CronArmSummary): string {
  const fires = summary.upcomingFires
  return [
    `VALID — ${summary.scheduleHuman}`,
    `instruction: ${summary.instruction}`,
    `mode: ${summary.mode} (${summary.modeConsequence})`,
    `next ${String(fires.length)} runs: ${fires.map((at) => new Date(at).toISOString()).join(", ")}`,
  ].join("\n")
}
