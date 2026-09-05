
export interface MermaidRepair {
  line: number
  from: string
  to: string
}

export interface MermaidRepairResult {
  source: string
  repairs: readonly MermaidRepair[]
}

interface LinkRule {
  from: string
  to: string
}

const LINK_RULES: readonly LinkRule[] = [
  { from: "-.x", to: "-.-x" },
  { from: "-.o", to: "-.-o" },
]

export const LINK_RULES_FOR_PARITY: readonly LinkRule[] = LINK_RULES

const LABEL_CLOSERS: Readonly<Record<string, string>> = { "[": "]", "(": ")", "{": "}" }

export function repairMermaidSource(source: string): MermaidRepairResult {
  const repairs: MermaidRepair[] = []
  let out = ""
  let line = 1
  let index = 0

  let quoted = false
  let inComment = false
  let inPipeLabel = false
  const labelStack: string[] = []

  while (index < source.length) {
    const char = source[index] ?? ""

    if (char === "\n") {
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
