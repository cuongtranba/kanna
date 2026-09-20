import { z } from "zod"
import type { JsonValue } from "../../shared/json"
import type { SystemOnePort, SystemOneQuestions } from "../../shared/system-one"
import { fail, ok, type ToolArgs, type ToolResult } from "../kanna-mcp-tool"

export const DECIDE_MAX_QUESTIONS = 16
export const DECIDE_MAX_STATE_CHARS = 32_000
export const DECIDE_MAX_CHOICE_OPTIONS = 64

export const DECIDE_DESCRIPTION =
  "Ask TypeSafe's System One model for fast, calibrated judgments over evidence you supply, so a decision that "
  + "hinges on reading text is made with numbers rather than a guess. Three question types, all answered in one "
  + "call and in parallel: noul (a yes/no question → probability 0–1), choice (pick one of the criteria you list → "
  + "the choice, a probability per option, and a confidence), score (a position on 2–10 levels you describe → the "
  + "score and a confidence). Put the evidence in `state` — a string, an array of texts, or an object with named "
  + "fields — and refer to fields inside instructions with backticks, e.g. `ticket.text`. Ask one narrow judgment "
  + "per question and split independent dimensions into separate questions; include a no-match option when nothing "
  + "may fit. Good uses: routing a request to a handler, shortlisting or ranking candidates, deciding whether a "
  + "report claims more than it shows, judging whether a task is specific enough for a fresh-context worker. Not "
  + "for anything you can compute, for dates, counting or arithmetic, or for anything that needs generated text — "
  + "the model returns numbers only. Read confidence as concentration of the answer: above 0.9 act on it, 0.5–0.9 "
  + "confirm first, below 0.5 do not guess. The state you send leaves the machine for api.typesafe.ai."

const stateSchema = z
  .union([
    z.string(),
    z.array(z.string()),
    z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  ])
  .refine(
    (state) => JSON.stringify(state).length <= DECIDE_MAX_STATE_CHARS,
    `state is too large (keep it under ${String(DECIDE_MAX_STATE_CHARS)} characters)`,
  )
  .describe("The evidence to judge: a string, an array of texts, or an object whose named fields the instructions reference with backticks.")

const noulQuestion = z.object({
  type: z.literal("noul"),
  instructions: z.string().min(1),
})

const choiceQuestion = z.object({
  type: z.literal("choice"),
  instructions: z.string().min(1),
  criteria: z
    .record(z.string(), z.string())
    .refine((criteria) => Object.keys(criteria).length >= 2, "a choice needs at least two criteria")
    .refine(
      (criteria) => Object.keys(criteria).length <= DECIDE_MAX_CHOICE_OPTIONS,
      `a choice takes at most ${String(DECIDE_MAX_CHOICE_OPTIONS)} criteria`,
    ),
})

const scoreQuestion = z.object({
  type: z.literal("score"),
  instructions: z.string().min(1),
  criteria: z.array(z.string().min(1)).min(2).max(10),
})

const questionsSchema = z
  .record(z.string(), z.discriminatedUnion("type", [noulQuestion, choiceQuestion, scoreQuestion]))
  .refine((questions) => Object.keys(questions).length >= 1, "ask at least one question")
  .refine(
    (questions) => Object.keys(questions).length <= DECIDE_MAX_QUESTIONS,
    `ask at most ${String(DECIDE_MAX_QUESTIONS)} questions per call`,
  )
  .describe("Questions keyed by a name you choose. noul: {type, instructions}. choice: {type, instructions, criteria: {option: meaning}}. score: {type, instructions, criteria: [level 0 meaning, level 1 meaning, …]}.")

export const DECIDE_SCHEMA = {
  state: stateSchema,
  questions: questionsSchema,
}

const DECIDE_INPUT = z.object(DECIDE_SCHEMA)

export type DecideToolFactory<TTool> = (
  name: string,
  description: string,
  schema: Record<string, z.ZodType<JsonValue | undefined>>,
  handler: (input: ToolArgs) => Promise<ToolResult>,
) => TTool

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
    .join("; ")
}

export function buildDecideToolList<TTool>(
  ask: SystemOnePort | null,
  tool: DecideToolFactory<TTool>,
): TTool[] {
  if (ask === null) return []
  const bound = ask
  return [
    tool("decide", DECIDE_DESCRIPTION, DECIDE_SCHEMA, async (input) => {
      const parsed = DECIDE_INPUT.safeParse(input)
      if (!parsed.success) return fail(`decide rejected: ${describeIssues(parsed.error)}`)
      const questions: SystemOneQuestions = parsed.data.questions
      const response = await bound({ state: parsed.data.state, questions })
      if (response === null) {
        return fail("System One did not answer (timeout, rate limit or network). Decide without it, or retry once.")
      }
      return ok(JSON.stringify(response))
    }),
  ]
}
