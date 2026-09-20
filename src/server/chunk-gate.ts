import { toError } from "../shared/errors"
import { log } from "../shared/log"
import {
  choiceOf,
  noulOf,
  scoreOf,
  type SystemOneAnswers,
  type SystemOnePort,
  type SystemOneQuestions,
} from "../shared/system-one"

export interface ChunkGateEnv {
  KANNA_CHUNK_GATE?: string
  TYPESAFE_API_KEY?: string
}

export interface ChunkGateConfig {
  apiKey: string
}

export function resolveChunkGateConfig(env: ChunkGateEnv): ChunkGateConfig | null {
  if (env.KANNA_CHUNK_GATE !== "enabled") return null
  const apiKey = env.TYPESAFE_API_KEY?.trim() ?? ""
  return apiKey.length > 0 ? { apiKey } : null
}

const SPECIFICITY_LEVELS: readonly string[] = [
  "Vague: no named file or symbol, no measurable target, could be read many different ways",
  "Partly specific: names a target, file or area, but gives no completion condition",
  "Fully specific: names the file(s) or symbols, the change to make, and how the worker knows it is done",
]

export const CHUNK_GATE_QUESTIONS: SystemOneQuestions = {
  is_instruction: {
    type: "noul",
    instructions:
      "Is `chunk` an instruction telling a worker what to change or build next, as opposed to a status report, a record of something already completed, a rule, a note, or a question?",
  },
  change_described_inline: {
    type: "noul",
    instructions:
      "Does the text of `chunk` ITSELF describe the code change to make (which file, module or symbol, and what to do to it), rather than only telling the worker to go read the real task from another file, plan or document?",
  },
  specificity: {
    type: "score",
    instructions:
      "How specific is `chunk` as a work instruction for a worker who starts with an empty context and only this text?",
    criteria: SPECIFICITY_LEVELS,
  },
  scope: {
    type: "choice",
    instructions: "How much work does `chunk` ask for?",
    criteria: {
      single_bounded: "Exactly one bounded unit of work with a clear stopping point",
      several_units: "Several separable tasks bundled together, each of which could be done and verified on its own",
      open_ended:
        "Open-ended or repeat-until work, e.g. 'as much as possible', 'keep extracting', 'more methods', 'execute the plan task-by-task'",
      none: "It does not ask for work at all",
    },
  },
  names_files: {
    type: "noul",
    instructions: "Does `chunk` name at least one concrete file path, module or symbol to change?",
  },
  has_done_condition: {
    type: "noul",
    instructions:
      "Does `chunk` state a verifiable condition by which the worker knows the chunk is finished (a command to run, a line count, a test to pass, a file to exist)?",
  },
}

export const CHUNK_GATE_MIN_CONFIDENCE = 0.7
const NOT_INSTRUCTION_MAX = 0.3
const INLINE_MIN = 0.3
const VAGUE_SCORE_MAX = 1.0
const YES = 0.5

export type ChunkScope = "single_bounded" | "several_units" | "open_ended" | "none"

export type ChunkVerdict =
  | { kind: "ok" }
  | { kind: "unanswered" }
  | { kind: "not_instruction" }
  | { kind: "pointer_only" }
  | { kind: "vague"; score: number; namesFiles: boolean; hasDoneCondition: boolean }
  | { kind: "too_big"; scope: "several_units" | "open_ended" }

export function assessChunk(answers: SystemOneAnswers): ChunkVerdict {
  const isInstruction = noulOf(answers, "is_instruction")
  const inline = noulOf(answers, "change_described_inline")
  const specificity = scoreOf(answers, "specificity")
  const scope = choiceOf(answers, "scope")
  const namesFiles = noulOf(answers, "names_files")
  const hasDoneCondition = noulOf(answers, "has_done_condition")
  if (
    isInstruction === null || inline === null || specificity === null
    || scope === null || namesFiles === null || hasDoneCondition === null
  ) {
    return { kind: "unanswered" }
  }
  if (isInstruction < NOT_INSTRUCTION_MAX) return { kind: "not_instruction" }
  if (inline < INLINE_MIN) return { kind: "pointer_only" }
  if (specificity.score < VAGUE_SCORE_MAX && specificity.confidence >= CHUNK_GATE_MIN_CONFIDENCE) {
    return {
      kind: "vague",
      score: specificity.score,
      namesFiles: namesFiles >= YES,
      hasDoneCondition: hasDoneCondition >= YES,
    }
  }
  const tooBig = scope.choice === "several_units" || scope.choice === "open_ended"
  if (tooBig && scope.confidence >= CHUNK_GATE_MIN_CONFIDENCE) {
    return { kind: "too_big", scope: scope.choice === "open_ended" ? "open_ended" : "several_units" }
  }
  return { kind: "ok" }
}

function formatScore(score: number): string {
  return (Math.round(score * 10) / 10).toFixed(1)
}

export function describeChunkVerdict(label: string, verdict: ChunkVerdict): string | null {
  switch (verdict.kind) {
    case "ok":
    case "unanswered":
      return null
    case "not_instruction":
      return `${label}: reads as a status line, a rule or a question rather than work for a worker to do — write the change to make`
    case "pointer_only":
      return `${label}: only points at another file or plan for the real task; a fresh-context worker gets this text alone — describe the change inline`
    case "vague": {
      const missing = [
        ...(verdict.namesFiles ? [] : ["it names no file or symbol"]),
        ...(verdict.hasDoneCondition ? [] : ["it states no way to know it is done"]),
      ]
      const detail = missing.length > 0 ? ` — ${missing.join(", and ")}` : ""
      return `${label}: too vague for a fresh-context worker (specificity ${formatScore(verdict.score)}/2)${detail}`
    }
    case "too_big":
      return verdict.scope === "open_ended"
        ? `${label}: open-ended with no stopping point — give it one bounded unit and a completion condition`
        : `${label}: bundles several separable tasks — split it so each can be done and verified alone`
  }
}

const LABEL_MAX_CHARS = 60

export function chunkLabel(subject: string): string {
  const flat = subject.trim().replace(/\s+/g, " ")
  const shown = flat.length <= LABEL_MAX_CHARS ? flat : `${flat.slice(0, LABEL_MAX_CHARS - 1)}…`
  return `task "${shown}"`
}

export interface ChunkGateItem {
  readonly label: string
  readonly text: string
}

export interface ChunkGate {
  audit(items: readonly ChunkGateItem[]): Promise<string[]>
}

export interface ChunkGateOptions {
  ask: SystemOnePort
  maxItems?: number
  concurrency?: number
  memoSize?: number
}

export const CHUNK_GATE_MAX_ITEMS = 12
const DEFAULT_CONCURRENCY = 4
const DEFAULT_MEMO_SIZE = 64

export function createChunkGate(options: ChunkGateOptions): ChunkGate {
  const maxItems = options.maxItems ?? CHUNK_GATE_MAX_ITEMS
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY
  const memoSize = options.memoSize ?? DEFAULT_MEMO_SIZE
  const memo = new Map<string, Promise<ChunkVerdict>>()

  function remember(text: string, verdict: Promise<ChunkVerdict>): void {
    memo.set(text, verdict)
    while (memo.size > memoSize) {
      const oldest = memo.keys().next().value
      if (oldest === undefined) break
      memo.delete(oldest)
    }
  }

  async function assess(text: string): Promise<ChunkVerdict> {
    try {
      const response = await options.ask({ state: { chunk: text }, questions: CHUNK_GATE_QUESTIONS })
      return response === null ? { kind: "unanswered" } : assessChunk(response.answers)
    } catch (error) {
      log.warn("[kanna/chunk-gate] audit failed", { message: toError(error).message })
      return { kind: "unanswered" }
    }
  }

  function verdictFor(text: string): Promise<ChunkVerdict> {
    const cached = memo.get(text)
    if (cached !== undefined) return cached
    const fresh = assess(text).then((verdict) => {
      if (verdict.kind === "unanswered") memo.delete(text)
      return verdict
    })
    remember(text, fresh)
    return fresh
  }

  return {
    async audit(items) {
      const audited = items.slice(0, maxItems)
      const verdicts: ChunkVerdict[] = []
      let next = 0
      const worker = async () => {
        for (;;) {
          const index = next++
          const item = audited[index]
          if (item === undefined) return
          verdicts[index] = await verdictFor(item.text)
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, audited.length) }, worker))
      const warnings: string[] = []
      for (const [index, item] of audited.entries()) {
        const line = describeChunkVerdict(item.label, verdicts[index] ?? { kind: "unanswered" })
        if (line !== null) warnings.push(line)
      }
      const skipped = items.length - audited.length
      if (skipped > 0) {
        warnings.push(`${String(skipped)} more task(s) were not audited (cap ${String(maxItems)} per call)`)
      }
      return warnings
    },
  }
}
