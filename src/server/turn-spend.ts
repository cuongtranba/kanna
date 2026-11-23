import { splitBilledTokens } from "../shared/token-pricing"
import type { ActiveTurn } from "./claude-session-state"
import { addCounter, TURN_COST_USD, TURN_TOKENS } from "./observability"

export function recordTurnSpend(active: ActiveTurn): void {
  const usage = active.usage
  if (!usage) return
  const attributes = { provider: active.provider, model: active.model }
  for (const [kind, count] of splitBilledTokens(usage)) {
    addCounter(TURN_TOKENS, count, { ...attributes, kind })
  }
  const cost = usage.costUsd
  if (cost !== undefined && Number.isFinite(cost) && cost >= 0) {
    addCounter(TURN_COST_USD, cost, attributes)
  }
}
