import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "../shared/json"
import type { TurnPlanStep } from "./codex-app-server-protocol"

export interface ParsedPlan {
  steps: TurnPlanStep[]
  explanation: string | null
}

function planStatus(raw: JsonValue | undefined): TurnPlanStep["status"] {
  if (raw === "completed") return "completed"
  if (raw === "in_progress" || raw === "inProgress") return "inProgress"
  return "pending"
}

export function parsePlanSteps(args: JsonObject): ParsedPlan | null {
  const plan = args.plan
  if (plan === undefined || !isJsonArray(plan)) return null
  const steps: TurnPlanStep[] = []
  for (const entry of plan) {
    if (!isJsonObject(entry)) continue
    const step = entry.step
    if (typeof step !== "string" || step.length === 0) continue
    steps.push({ step, status: planStatus(entry.status) })
  }
  if (steps.length === 0) return null
  return {
    steps,
    explanation: typeof args.explanation === "string" ? args.explanation : null,
  }
}
