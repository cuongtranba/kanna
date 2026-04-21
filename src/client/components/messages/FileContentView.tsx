import { useMemo } from "react"

interface FileContentViewProps {
  content: string
  isDiff?: boolean
  oldString?: string
  newString?: string
}

interface ParsedLine {
  lineNumber: number | null
  content: string
}

interface DiffLine {
  type: "context" | "removed" | "added"
  content: string
}

// Parse content and extract line numbers if they match the pattern: N→content
function parseContent(content: string): ParsedLine[] {
  const lines = content.split("\n")
  const lineNumberPattern = /^\s*(\d+)→(.*)$/

  return lines.map((line) => {
    const match = line.match(lineNumberPattern)
    if (match) {
      return {
        lineNumber: parseInt(match[1], 10),
        content: match[2],
      }
    }
    return {
      lineNumber: null,
      content: line,
    }
  })
}

// Strip XML-like tags from content
function stripXmlTags(text: string): string {
  return text.replace(/<[^>]+>/g, "")
}

// Compute unified diff (same logic as EditDiffView)
function computeUnifiedDiff(oldStr: string, newStr: string): DiffLine[] {
  const oldLines = oldStr.split("\n")
  const newLines = newStr.split("\n")

  const lcs = buildLCS(oldLines, newLines)
  const rawDiff = buildRawDiff(oldLines, newLines, lcs)

  return buildDiffLines(rawDiff)
}

type RawLine = { type: "context" | "removed" | "added"; text: string; oldIdx: number; newIdx: number }

function buildLCS(a: string[], b: string[]): number[][] {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp
}

function buildRawDiff(oldLines: string[], newLines: string[], dp: number[][]): RawLine[] {
  const result: RawLine[] = []
  let i = oldLines.length
  let j = newLines.length

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: "context", text: oldLines[i - 1], oldIdx: i, newIdx: j })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: "added", text: newLines[j - 1], oldIdx: i, newIdx: j })
      j--
    } else {
      result.push({ type: "removed", text: oldLines[i - 1], oldIdx: i, newIdx: j })
      i--
    }
  }

  return result.reverse()
}

function buildDiffLines(rawDiff: RawLine[]): DiffLine[] {
  return rawDiff.map((d) => {
    const prefix = d.type === "removed" ? "-" : d.type === "added" ? "+" : " "
    return { type: d.type, content: `${prefix}${d.text}` }
  })
}

export function FileContentView({ content, isDiff = false, oldString, newString }: FileContentViewProps) {
  // Diff mode
  const diffLines = useMemo(() => {
    if (isDiff && oldString !== undefined && newString !== undefined) {
      return computeUnifiedDiff(oldString, newString)
    }
    return []
  }, [isDiff, oldString, newString])

  // Text mode with line numbers
  const parsedLines = useMemo(() => {
    if (!isDiff) {
      return parseContent(content)
    }
    return []
  }, [content, isDiff])

  const hasLineNumbers = useMemo(() => {
    return parsedLines.some((line) => line.lineNumber !== null)
  }, [parsedLines])

  // Diff rendering
  if (isDiff && diffLines.length > 0) {
    return (
      <div className="my-1 rounded-lg border border-border overflow-hidden">
        <div className="overflow-auto max-h-64 md:max-h-[50vh]">
          <table className="w-full border-collapse text-xs font-mono">
            <tbody>
              {diffLines.map((line, i) => {
                const bg =
                  line.type === "removed"
                    ? "bg-destructive/10 dark:bg-destructive/15"
                    : line.type === "added"
                      ? "bg-success/10 dark:bg-success/15"
                      : ""

                const textColor =
                  line.type === "removed"
                    ? "text-destructive"
                    : line.type === "added"
                      ? "text-success"
                      : "text-foreground"

                return (
                  <tr key={i} className={bg}>
                    <td className={`px-2 py-0 select-none w-0 whitespace-nowrap ${line.type === "removed" ? "text-destructive/50" : line.type === "added" ? "text-success/50" : "text-muted-foreground/50"}`}>
                      {line.type === "removed" ? "-" : line.type === "added" ? "+" : " "}
                    </td>
                    <td className={`px-2 py-0 whitespace-pre select-all ${textColor}`}>
                      {line.content.slice(1)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  // Text rendering with optional line numbers
  return (
    <div className="my-1 rounded-lg border border-border overflow-hidden">
      <div className="overflow-auto max-h-64 md:max-h-[50vh]">
        <table className="w-full border-collapse text-xs font-mono">
          <tbody>
            {parsedLines.map((line, i) => (
              <tr key={i}>
                {hasLineNumbers && (
                  <td className="px-2 py-0 select-none w-0 whitespace-nowrap text-muted-foreground/50 text-right">
                    {line.lineNumber !== null ? line.lineNumber : ""}
                  </td>
                )}
                <td className="px-2 py-0 whitespace-pre select-all text-foreground">
                  {stripXmlTags(line.content)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
