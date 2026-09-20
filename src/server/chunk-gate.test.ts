import { describe, expect, test } from "bun:test"
import { isJsonObject } from "../shared/json"
import type { SystemOneAnswers, SystemOneRequest, SystemOneResponse } from "../shared/system-one"
import {
  assessChunk,
  CHUNK_GATE_MAX_ITEMS,
  CHUNK_GATE_MIN_CONFIDENCE,
  CHUNK_GATE_QUESTIONS,
  chunkLabel,
  createChunkGate,
  describeChunkVerdict,
  resolveChunkGateConfig,
} from "./chunk-gate"

interface AnswerShape {
  isInstruction: number
  inline: number
  specificity: number
  specificityConfidence: number
  scope: "single_bounded" | "several_units" | "open_ended" | "none"
  scopeConfidence: number
  namesFiles: number
  hasDoneCondition: number
}

function answers(shape: AnswerShape): SystemOneAnswers {
  return {
    is_instruction: { type: "noul", noul: shape.isInstruction },
    change_described_inline: { type: "noul", noul: shape.inline },
    specificity: { type: "score", score: shape.specificity, confidence: shape.specificityConfidence },
    scope: {
      type: "choice",
      choice: shape.scope,
      confidence: shape.scopeConfidence,
      probabilities: { [shape.scope]: shape.scopeConfidence },
    },
    names_files: { type: "noul", noul: shape.namesFiles },
    has_done_condition: { type: "noul", noul: shape.hasDoneCondition },
  }
}

const SPECIFIC_SINGLE = answers({
  isInstruction: 0.95, inline: 0.99, specificity: 2.0, specificityConfidence: 1.0,
  scope: "single_bounded", scopeConfidence: 0.9, namesFiles: 0.99, hasDoneCondition: 0.95,
})
const STATUS_ROW = answers({
  isInstruction: 0.06, inline: 0.1, specificity: 0.13, specificityConfidence: 0.81,
  scope: "none", scopeConfidence: 0.9, namesFiles: 0.06, hasDoneCondition: 0.13,
})
const POINTER_STUB = answers({
  isInstruction: 0.93, inline: 0.10, specificity: 1.61, specificityConfidence: 0.43,
  scope: "open_ended", scopeConfidence: 0.8, namesFiles: 0.82, hasDoneCondition: 0.94,
})
const ROADMAP_BULLET = answers({
  isInstruction: 0.8, inline: 0.6, specificity: 0.35, specificityConfidence: 0.8,
  scope: "several_units", scopeConfidence: 0.5, namesFiles: 0.09, hasDoneCondition: 0.10,
})
const OPEN_ENDED = answers({
  isInstruction: 0.95, inline: 0.99, specificity: 2.0, specificityConfidence: 1.0,
  scope: "open_ended", scopeConfidence: 0.83, namesFiles: 0.99, hasDoneCondition: 0.9,
})
const SEVERAL_UNSURE = answers({
  isInstruction: 0.95, inline: 0.99, specificity: 2.0, specificityConfidence: 1.0,
  scope: "several_units", scopeConfidence: 0.43, namesFiles: 0.99, hasDoneCondition: 0.9,
})

describe("resolveChunkGateConfig", () => {
  test("enabled only when the switch is on AND a key is present", () => {
    expect(resolveChunkGateConfig({ KANNA_CHUNK_GATE: "enabled", TYPESAFE_API_KEY: "k" })).toEqual({ apiKey: "k" })
    expect(resolveChunkGateConfig({ KANNA_CHUNK_GATE: "enabled" })).toBeNull()
    expect(resolveChunkGateConfig({ TYPESAFE_API_KEY: "k" })).toBeNull()
    expect(resolveChunkGateConfig({ KANNA_CHUNK_GATE: "disabled", TYPESAFE_API_KEY: "k" })).toBeNull()
    expect(resolveChunkGateConfig({ KANNA_CHUNK_GATE: "enabled", TYPESAFE_API_KEY: "   " })).toBeNull()
  })
})

describe("assessChunk", () => {
  test("a specific, bounded instruction passes", () => {
    expect(assessChunk(SPECIFIC_SINGLE)).toEqual({ kind: "ok" })
  })

  test("a status row or a completed-item record is not an instruction", () => {
    expect(assessChunk(STATUS_ROW)).toEqual({ kind: "not_instruction" })
  })

  test("a stub that only points at another file is pointer_only, even though it names a file and a verify command", () => {
    expect(assessChunk(POINTER_STUB)).toEqual({ kind: "pointer_only" })
  })

  test("a vague bullet reports which ingredients are missing", () => {
    expect(assessChunk(ROADMAP_BULLET)).toEqual({
      kind: "vague",
      score: 0.35,
      namesFiles: false,
      hasDoneCondition: false,
    })
  })

  test("an open-ended chunk is too big", () => {
    expect(assessChunk(OPEN_ENDED)).toEqual({ kind: "too_big", scope: "open_ended" })
  })

  test("a scope call below the confidence floor does not warn", () => {
    expect(SEVERAL_UNSURE.scope?.type === "choice" && SEVERAL_UNSURE.scope.confidence < CHUNK_GATE_MIN_CONFIDENCE).toBe(true)
    expect(assessChunk(SEVERAL_UNSURE)).toEqual({ kind: "ok" })
  })

  test("a low-confidence vague score does not warn either", () => {
    const unsure = answers({
      isInstruction: 0.8, inline: 0.6, specificity: 0.6, specificityConfidence: 0.3,
      scope: "single_bounded", scopeConfidence: 0.9, namesFiles: 0.5, hasDoneCondition: 0.5,
    })
    expect(assessChunk(unsure)).toEqual({ kind: "ok" })
  })

  test("missing answers are unanswered, never a warning", () => {
    expect(assessChunk({})).toEqual({ kind: "unanswered" })
    const { specificity: _dropped, ...partial } = SPECIFIC_SINGLE
    expect(assessChunk(partial)).toEqual({ kind: "unanswered" })
  })

  test("the question set asks about `chunk` and nothing else", () => {
    for (const question of Object.values(CHUNK_GATE_QUESTIONS)) {
      expect(question.instructions).toContain("`chunk`")
    }
    expect(Object.keys(CHUNK_GATE_QUESTIONS).sort()).toEqual([
      "change_described_inline",
      "has_done_condition",
      "is_instruction",
      "names_files",
      "scope",
      "specificity",
    ])
  })
})

describe("describeChunkVerdict", () => {
  test("ok and unanswered produce no line", () => {
    expect(describeChunkVerdict("task \"x\"", { kind: "ok" })).toBeNull()
    expect(describeChunkVerdict("task \"x\"", { kind: "unanswered" })).toBeNull()
  })

  test("each warning names the item and says what to change", () => {
    expect(describeChunkVerdict("task \"Phase 1 done\"", { kind: "not_instruction" }))
      .toBe("task \"Phase 1 done\": reads as a status line, a rule or a question rather than work for a worker to do — write the change to make")
    expect(describeChunkVerdict("task \"Do the next chunk\"", { kind: "pointer_only" }))
      .toBe("task \"Do the next chunk\": only points at another file or plan for the real task; a fresh-context worker gets this text alone — describe the change inline")
    expect(describeChunkVerdict("task \"Cross-project\"", { kind: "vague", score: 0.35, namesFiles: false, hasDoneCondition: false }))
      .toBe("task \"Cross-project\": too vague for a fresh-context worker (specificity 0.4/2) — it names no file or symbol, and it states no way to know it is done")
    expect(describeChunkVerdict("task \"Fix\"", { kind: "vague", score: 0.8, namesFiles: true, hasDoneCondition: false }))
      .toBe("task \"Fix\": too vague for a fresh-context worker (specificity 0.8/2) — it states no way to know it is done")
    expect(describeChunkVerdict("task \"Extract more\"", { kind: "too_big", scope: "open_ended" }))
      .toBe("task \"Extract more\": open-ended with no stopping point — give it one bounded unit and a completion condition")
    expect(describeChunkVerdict("task \"Lifecycle\"", { kind: "too_big", scope: "several_units" }))
      .toBe("task \"Lifecycle\": bundles several separable tasks — split it so each can be done and verified alone")
  })
})

describe("chunkLabel", () => {
  test("quotes the subject and truncates a long one", () => {
    expect(chunkLabel("Extract X")).toBe("task \"Extract X\"")
    const long = "a".repeat(80)
    const label = chunkLabel(long)
    expect(label).toBe(`task "${"a".repeat(59)}…"`)
  })
})

function fakeAsk(byText: Record<string, SystemOneAnswers | null>) {
  const calls: SystemOneRequest[] = []
  const ask = async (request: SystemOneRequest): Promise<SystemOneResponse | null> => {
    calls.push(request)
    const state = request.state
    const chunk = isJsonObject(state) ? state.chunk : undefined
    const text = typeof chunk === "string" ? chunk : ""
    const found = byText[text]
    if (found === undefined) throw new Error(`no fixture for ${text}`)
    if (found === null) return null
    return { model: "jev-1.13.0", answers: found, inputTokens: 100 }
  }
  return { ask, calls }
}

describe("createChunkGate", () => {
  test("one warning line per flagged item, in item order, silent on the good ones", async () => {
    const { ask, calls } = fakeAsk({
      "Phase 1 done": STATUS_ROW,
      "Extract X from a.ts into b.ts": SPECIFIC_SINGLE,
      "Reduce agent.ts until under 600": OPEN_ENDED,
    })
    const gate = createChunkGate({ ask })
    const warnings = await gate.audit([
      { label: "task \"Phase 1 done\"", text: "Phase 1 done" },
      { label: "task \"Extract X\"", text: "Extract X from a.ts into b.ts" },
      { label: "task \"Reduce\"", text: "Reduce agent.ts until under 600" },
    ])
    expect(warnings).toEqual([
      "task \"Phase 1 done\": reads as a status line, a rule or a question rather than work for a worker to do — write the change to make",
      "task \"Reduce\": open-ended with no stopping point — give it one bounded unit and a completion condition",
    ])
    expect(calls).toHaveLength(3)
    expect(calls[0]?.questions).toBe(CHUNK_GATE_QUESTIONS)
    expect(calls[0]?.state).toEqual({ chunk: "Phase 1 done" })
  })

  test("fails open: a throwing or empty answer yields no warning and no exception", async () => {
    const throwing = createChunkGate({ ask: async () => { throw new Error("network down") } })
    await expect(throwing.audit([{ label: "t", text: "anything" }])).resolves.toEqual([])
    const empty = createChunkGate({ ask: async () => null })
    await expect(empty.audit([{ label: "t", text: "anything" }])).resolves.toEqual([])
  })

  test("asks about a given text once, even across calls", async () => {
    const { ask, calls } = fakeAsk({ "Phase 1 done": STATUS_ROW })
    const gate = createChunkGate({ ask })
    const first = await gate.audit([{ label: "a", text: "Phase 1 done" }, { label: "b", text: "Phase 1 done" }])
    const second = await gate.audit([{ label: "c", text: "Phase 1 done" }])
    expect(calls).toHaveLength(1)
    expect(first).toHaveLength(2)
    expect(second).toEqual(["c: reads as a status line, a rule or a question rather than work for a worker to do — write the change to make"])
  })

  test("audits at most the cap and says how many it skipped", async () => {
    const fixtures: Record<string, SystemOneAnswers> = {}
    const items = Array.from({ length: CHUNK_GATE_MAX_ITEMS + 3 }, (_, i) => {
      const text = `Task number ${String(i)}`
      fixtures[text] = SPECIFIC_SINGLE
      return { label: `task ${String(i)}`, text }
    })
    const { ask, calls } = fakeAsk(fixtures)
    const warnings = await createChunkGate({ ask }).audit(items)
    expect(calls).toHaveLength(CHUNK_GATE_MAX_ITEMS)
    expect(warnings).toEqual([`3 more task(s) were not audited (cap ${String(CHUNK_GATE_MAX_ITEMS)} per call)`])
  })

  test("an empty item list asks nothing", async () => {
    const { ask, calls } = fakeAsk({})
    await expect(createChunkGate({ ask }).audit([])).resolves.toEqual([])
    expect(calls).toHaveLength(0)
  })
})
