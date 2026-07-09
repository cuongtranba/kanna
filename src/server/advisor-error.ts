// Pure classifier for the Anthropic API's advisor-pairing rejection.
//
// When a chat pairs an executor model with an advisor model that ranks BELOW
// it, the API rejects the turn with a 400 whose body looks like:
//
//   API Error: 400 tools.23.model: 'claude-haiku-4-5-20251001' cannot be used
//   as an advisor
//
// `adr-20260709-advisor-tool` deliberately relies on this API 400 instead of a
// client-side rank matrix (which drifts as models are added). This helper turns
// the cryptic raw message into a single actionable guidance sentence that the
// existing api_error turn-error path appends to the card. No IO — pure string.

// Anchor on the API's stable phrase; capture the offending model id when the
// quoted form is present so the guidance can name it.
const ADVISOR_REJECTION = /'([^']+)'\s+cannot be used as an advisor/i
const ADVISOR_REJECTION_BARE = /cannot be used as an advisor/i

/**
 * Returns a friendly guidance sentence when `text` is the API's advisor-pairing
 * rejection, or `null` for any other text (no behaviour change for other 400s).
 */
export function describeAdvisorApiError(text: string): string | null {
  if (typeof text !== "string" || text.length === 0) return null

  const withModel = ADVISOR_REJECTION.exec(text)
  if (withModel) {
    const model = withModel[1]
    return `Advisor rejected: “${model}” is not strong enough to advise the executor model — the advisor must rank at least as high as the executor. Pick a stronger advisor model, or set “No Advisor”.`
  }

  if (ADVISOR_REJECTION_BARE.test(text)) {
    return "Advisor rejected: the advisor must rank at least as high as the executor model. Pick a stronger advisor model, or set “No Advisor”."
  }

  return null
}
