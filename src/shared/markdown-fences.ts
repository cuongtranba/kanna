export const FENCE_END_REGEX = /^[ \t]*`{3,}[ \t]*$/

function closingFenceRegex(fenceLength: number): RegExp {
  return new RegExp(`^[ \\t]*\`{${String(fenceLength)},}[ \\t]*$`)
}

export interface FenceBody {
  source: string
  lastLineIndex: number
  closed: boolean
}

export function scanFenceBody(
  lines: readonly string[],
  startLineIndex: number,
  fence: string,
): FenceBody {
  const endRegex = closingFenceRegex(fence.length)
  const bodyLines: string[] = []
  let lastLineIndex = startLineIndex

  for (let i = startLineIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) break
    lastLineIndex = i
    if (endRegex.test(line)) return { source: bodyLines.join("\n"), lastLineIndex, closed: true }
    bodyLines.push(line)
  }

  return { source: bodyLines.join("\n"), lastLineIndex, closed: false }
}
