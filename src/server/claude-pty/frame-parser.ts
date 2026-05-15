const ANSI_REGEX = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, "")
}

const MODEL_LINE = /\bModel:\s*([a-zA-Z0-9-]+)/

export function detectModelSwitch(serializedFrame: string): string | null {
  const plain = stripAnsi(serializedFrame)
  const m = plain.match(MODEL_LINE)
  return m ? m[1] : null
}

const RATE_LIMIT_LINE = /[Rr]esets?\s+at\s+(\d{1,2}:\d{2})\s+([A-Z]{2,4})/

export function detectRateLimit(serializedFrame: string): { resetAt: string; tz: string } | null {
  const plain = stripAnsi(serializedFrame)
  const m = plain.match(RATE_LIMIT_LINE)
  return m ? { resetAt: m[1], tz: m[2] } : null
}
