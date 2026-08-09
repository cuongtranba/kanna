/**
 * Repair the link spellings mermaid rejects but a model reliably writes.
 *
 * A model asked for a dotted, cross-ended edge reasons "dotted is `-.`, crossed
 * is `x`" and writes `-.x`. mermaid's grammar spells it `-.-x`, so the whole
 * diagram fails to parse — and because jison reports the token it choked on
 * rather than the one that was wrong, the error points at the FOLLOWING line.
 * The reader is shown a broken diagram and a misleading line number for a
 * single missing dash.
 *
 * Two properties make this a repair rather than a guess:
 *
 * 1. **It runs only after mermaid has already rejected the source.** A diagram
 *    that renders is never rewritten, so no valid diagram can change meaning.
 * 2. **It only rewrites spellings mermaid has no other reading for.** Every
 *    rule below is pinned by a parser probe in `mermaidRepair.parity.test.ts`:
 *    the `from` spelling fails to parse and the `to` spelling parses.
 *
 * The scanner skips the spans where a link operator is ordinary text — quoted
 * strings, `[]`/`()`/`{}` node labels, `|…|` edge labels and `%%` comments.
 * That guard is load-bearing, not defensive: `A["uses -.x here"]` is a VALID
 * diagram, so a global search-and-replace would silently corrupt an author's
 * label the moment some other line of the same diagram failed to parse.
 *
 * Pure — no DOM, no mermaid import.
 */

/** One applied rewrite, for honest reporting in the UI. */
export interface MermaidRepair {
  /** 1-based line in the original source. */
  line: number
  /** The rejected spelling, e.g. `-.x`. */
  from: string
  /** What it was rewritten to, e.g. `-.-x`. */
  to: string
}

export interface MermaidRepairResult {
  /** The repaired source. Identical to the input when `repairs` is empty. */
  source: string
  /** Applied rewrites in source order. Empty means nothing was changed. */
  repairs: readonly MermaidRepair[]
}

/**
 * Rejected link spelling → its accepted equivalent.
 *
 * Longest `from` first: the scanner takes the first match at a position, so a
 * shorter prefix must never shadow a longer rule. Adding a rule REQUIRES adding
 * its pair to the parity test — a rule mermaid actually accepts would rewrite
 * working diagrams.
 */
interface LinkRule {
  from: string
  to: string
}

const LINK_RULES: readonly LinkRule[] = [
  // Dotted link, cross end. mermaid: `-.-x`.
  { from: "-.x", to: "-.-x" },
  // Dotted link, circle end. mermaid: `-.-o`.
  { from: "-.o", to: "-.-o" },
]

/**
 * The rule table, exposed for `mermaidRepair.parity.test.ts` only — that test
 * drives mermaid's real parser over every entry. Not part of the module's
 * runtime contract; nothing in the app should branch on it.
 */
export const LINK_RULES_FOR_PARITY: readonly LinkRule[] = LINK_RULES

/** Openers whose matching closer ends a label span. */
const LABEL_CLOSERS: Readonly<Record<string, string>> = { "[": "]", "(": ")", "{": "}" }

export function repairMermaidSource(source: string): MermaidRepairResult {
  const repairs: MermaidRepair[] = []
  let out = ""
  let line = 1
  let index = 0

  // Exactly one of these is active at a time; each suppresses rule matching.
  let quoted = false
  let inComment = false
  let inPipeLabel = false
  const labelStack: string[] = []

  while (index < source.length) {
    const char = source[index] ?? ""

    if (char === "\n") {
      // A comment and an unterminated pipe label both end at the line break;
      // a bracket label may not span lines either, so reset the lot.
      inComment = false
      inPipeLabel = false
      quoted = false
      labelStack.length = 0
      line += 1
      out += char
      index += 1
      continue
    }

    if (inComment) {
      out += char
      index += 1
      continue
    }

    if (quoted) {
      if (char === '"') quoted = false
      out += char
      index += 1
      continue
    }

    if (char === '"') {
      quoted = true
      out += char
      index += 1
      continue
    }

    if (source.startsWith("%%", index)) {
      inComment = true
      out += "%%"
      index += 2
      continue
    }

    if (labelStack.length > 0) {
      if (char === labelStack[labelStack.length - 1]) labelStack.pop()
      else if (LABEL_CLOSERS[char]) labelStack.push(LABEL_CLOSERS[char])
      out += char
      index += 1
      continue
    }

    if (LABEL_CLOSERS[char]) {
      labelStack.push(LABEL_CLOSERS[char])
      out += char
      index += 1
      continue
    }

    if (char === "|") {
      inPipeLabel = !inPipeLabel
      out += char
      index += 1
      continue
    }

    if (inPipeLabel) {
      out += char
      index += 1
      continue
    }

    const rule = LINK_RULES.find((candidate) => source.startsWith(candidate.from, index))
    if (rule) {
      out += rule.to
      repairs.push({ line, from: rule.from, to: rule.to })
      index += rule.from.length
      continue
    }

    out += char
    index += 1
  }

  return { source: out, repairs }
}
