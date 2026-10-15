export const TARGET_LAG_MS = 220
export const MIN_GRAPHEMES_PER_SECOND = 45
export const MAX_FRAME_DELTA_MS = 50
export const FIRST_FRAME_DELTA_MS = 16

const TAIL_SLICE_MARKER = "…"
const ZERO_WIDTH_JOINER = "‍"
const WORD_BODY = /^[\p{L}\p{N}\p{M}]/u
const WORD_CONTINUATION = /^[\p{L}\p{N}\p{M}'’]/u
const FENCE_LINE = /^\s*(```|~~~)/
const BLANK_LINE = /^\s*$/

export type FenceSpan = readonly [start: number, end: number]

export interface TypewriterState {
  text: string
  graphemes: readonly string[]
  fences: readonly FenceSpan[]
  total: number
  shown: number
  carry: number
  lastTimestamp: number | null
  frames: number
}

export interface TypewriterFrameAction {
  type: "frame"
  timestamp: number
  text: string
}

export interface TypewriterView {
  revealed: string
  ghost: string
  revealing: boolean
}

export const INITIAL_TYPEWRITER_STATE: TypewriterState = {
  text: "",
  graphemes: [],
  fences: [],
  total: 0,
  shown: 0,
  carry: 0,
  lastTimestamp: null,
  frames: 0,
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function segmentGraphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment)
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff
}

function isIncompleteTail(grapheme: string): boolean {
  if (grapheme.endsWith(ZERO_WIDTH_JOINER)) return true
  return isHighSurrogate(grapheme.charCodeAt(grapheme.length - 1))
}

function revealableCount(graphemes: readonly string[]): number {
  const last = graphemes[graphemes.length - 1]
  return last !== undefined && isIncompleteTail(last) ? graphemes.length - 1 : graphemes.length
}

function isLineBreak(grapheme: string): boolean {
  return grapheme === "\n" || grapheme === "\r\n"
}

function fenceSpans(graphemes: readonly string[]): FenceSpan[] {
  const spans: FenceSpan[] = []
  let openedAt: number | null = null
  let lineStart = 0
  for (let index = 0; index <= graphemes.length; index += 1) {
    const atEnd = index === graphemes.length
    if (!atEnd && !isLineBreak(graphemes[index] ?? "")) continue
    if (FENCE_LINE.test(graphemes.slice(lineStart, index).join(""))) {
      if (openedAt === null) {
        openedAt = lineStart
      } else {
        spans.push([openedAt, atEnd ? index : index + 1])
        openedAt = null
      }
    }
    lineStart = index + 1
  }
  if (openedAt !== null) spans.push([openedAt, graphemes.length])
  return spans
}

function skipFence(fences: readonly FenceSpan[], shown: number, total: number): number {
  const enclosing = fences.find(([start, end]) => start < shown && shown < end)
  return enclosing === undefined ? shown : Math.min(total, enclosing[1])
}

export function syncSnapshot(state: TypewriterState, text: string): TypewriterState {
  if (state.text === text) return state
  const graphemes = segmentGraphemes(text)
  const total = revealableCount(graphemes)
  const fences = fenceSpans(graphemes)
  if (text.startsWith(state.text)) {
    const shown = skipFence(fences, Math.min(state.shown, total), total)
    return { ...state, text, graphemes, fences, total, shown }
  }
  const shown = text.startsWith(TAIL_SLICE_MARKER) ? total : 0
  return { ...state, text, graphemes, fences, total, shown, carry: 0, lastTimestamp: null }
}

function advance(state: TypewriterState, timestamp: number): TypewriterState {
  const backlog = state.total - state.shown
  if (backlog <= 0) {
    return state.lastTimestamp === null ? state : { ...state, carry: 0, lastTimestamp: null }
  }
  const elapsed = state.lastTimestamp === null ? FIRST_FRAME_DELTA_MS : timestamp - state.lastTimestamp
  const deltaMs = Math.min(MAX_FRAME_DELTA_MS, Math.max(0, elapsed))
  const rate = Math.max(MIN_GRAPHEMES_PER_SECOND, backlog / (TARGET_LAG_MS / 1000))
  const carry = state.carry + (rate * deltaMs) / 1000
  const step = Math.floor(carry)
  const shown = skipFence(state.fences, Math.min(state.total, state.shown + step), state.total)
  const caughtUp = shown === state.total
  return {
    ...state,
    shown,
    carry: caughtUp ? 0 : carry - step,
    lastTimestamp: caughtUp ? null : timestamp,
    frames: state.frames + 1,
  }
}

export function typewriterReducer(state: TypewriterState, action: TypewriterFrameAction): TypewriterState {
  return advance(syncSnapshot(state, action.text), action.timestamp)
}

export function restOfWord(graphemes: readonly string[], shown: number, total: number): string {
  const before = graphemes[shown - 1]
  if (before === undefined || !WORD_BODY.test(before)) return ""
  let end = shown
  while (end < total && WORD_CONTINUATION.test(graphemes[end] ?? "")) end += 1
  return graphemes.slice(shown, end).join("")
}

export function viewOf(state: TypewriterState, instant: boolean): TypewriterView {
  const shown = instant ? state.total : state.shown
  return {
    revealed: state.graphemes.slice(0, shown).join(""),
    ghost: restOfWord(state.graphemes, shown, state.total),
    revealing: shown < state.total,
  }
}

export function splitParagraphs(source: string): string[] {
  const lines = source.split("\n")
  const lastIndex = lines.length - 1
  const chunks: string[][] = []
  let current: string[] = []
  let hasContent = false
  let hasBlank = false
  let inFence = false
  lines.forEach((line, index) => {
    if (FENCE_LINE.test(line)) inFence = !inFence
    const blank = !inFence && BLANK_LINE.test(line)
    if (blank && index < lastIndex) {
      current.push(line)
      hasBlank = true
      return
    }
    if (hasContent && hasBlank) {
      chunks.push(current)
      current = []
      hasContent = false
      hasBlank = false
    }
    if (blank) {
      if (current.length > 0) chunks.push(current)
      current = []
      return
    }
    current.push(line)
    hasContent = true
  })
  return [...chunks, current].map((chunk) => chunk.join("\n"))
}

function countOccurrences(source: string, needle: string): number {
  return source.split(needle).length - 1
}

function isInsideOpenFence(source: string): boolean {
  return source.split("\n").filter((line) => FENCE_LINE.test(line)).length % 2 === 1
}

export function closeOpenMarkup(source: string): string {
  if (isInsideOpenFence(source)) return source
  let closed = countOccurrences(source, "`") % 2 === 1 ? `${source}\`` : source
  const outsideCode = closed.replace(/```[\s\S]*?```|`[^`]*`/g, "")
  if (countOccurrences(outsideCode, "**") % 2 === 1) closed = `${closed}**`
  return closed
}
